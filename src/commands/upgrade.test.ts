import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assetNameForPlatform,
  binaryNameForPlatform,
  computeSha256,
  extractZipBinary,
  parseChecksums,
  selectChecksumAsset,
  verifyChecksum,
  type Release,
} from "./upgrade.ts";

function localEntryHeader(
  name: Buffer,
  compressed: Buffer,
  uncompressedSize: number,
  method: number,
): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, compressed]);
}

function centralEntryHeader(
  name: Buffer,
  compressed: Buffer,
  uncompressedSize: number,
  method: number,
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(method, 10);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.length, 28);
  return Buffer.concat([header, name]);
}

function endRecord(centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(1, 8);
  record.writeUInt16LE(1, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

function singleFileZip(name: string, contents: string, method: number): Buffer {
  const binary = Buffer.from(contents);
  const compressed = method === 8 ? deflateRawSync(binary) : binary;
  const encodedName = Buffer.from(name);
  const local = localEntryHeader(encodedName, compressed, binary.length, method);
  const central = centralEntryHeader(encodedName, compressed, binary.length, method);
  return Buffer.concat([local, central, endRecord(central.length, local.length)]);
}

describe("upgrade release names", () => {
  it("uses zipped platform and architecture assets", () => {
    expect(assetNameForPlatform("darwin", "arm64")).toBe("lazyotp-darwin-arm64.zip");
    expect(assetNameForPlatform("linux", "x64")).toBe("lazyotp-linux-x64.zip");
    expect(assetNameForPlatform("win32", "x64")).toBe("lazyotp-windows-x64.zip");
  });

  it("rejects unsupported platforms and architectures", () => {
    expect(assetNameForPlatform("freebsd", "x64")).toBeUndefined();
    expect(assetNameForPlatform("linux", "riscv64")).toBeUndefined();
  });

  it("uses the executable name stored inside each archive", () => {
    expect(binaryNameForPlatform("darwin")).toBe("lazyotp");
    expect(binaryNameForPlatform("linux")).toBe("lazyotp");
    expect(binaryNameForPlatform("win32")).toBe("lazyotp.exe");
  });
});

function twoFileZip(nameA: string, nameB: string): Buffer {
  const binary = Buffer.from("binary-content");
  const compressed = deflateRawSync(binary);
  const encA = Buffer.from(nameA);
  const encB = Buffer.from(nameB);
  const localA = localEntryHeader(encA, compressed, binary.length, 8);
  const localB = localEntryHeader(encB, compressed, binary.length, 8);
  const centralA = centralEntryHeader(encA, compressed, binary.length, 8);
  const centralB = centralEntryHeader(encB, compressed, binary.length, 8);
  const centralOffset = localA.length + localB.length;
  const centralData = Buffer.concat([centralA, centralB]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(2, 8);
  end.writeUInt16LE(2, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([localA, localB, centralData, end]);
}

function singleFileZipWithMethod(name: string, contents: string, method: number): Buffer {
  return singleFileZip(name, contents, method);
}

describe("extractZipBinary", () => {
  it.each([0, 8])("extracts compression method %i", (method) => {
    const archive = singleFileZip("lazyotp", "compiled-binary", method);
    const binary = extractZipBinary(archive, "lazyotp");
    expect(Buffer.from(binary).toString()).toBe("compiled-binary");
  });

  it("accepts a renamed executable when it is the only file", () => {
    const archive = singleFileZip("renamed", "compiled-binary", 8);
    const binary = extractZipBinary(archive, "lazyotp");
    expect(Buffer.from(binary).toString()).toBe("compiled-binary");
  });

  it("rejects data that is not a ZIP archive", () => {
    expect(() => extractZipBinary(Buffer.from("not-an-archive"), "lazyotp")).toThrow(
      "not a valid ZIP archive",
    );
  });

  it("throws for unsupported compression method", () => {
    // method 12 (bzip2) is neither stored (0) nor deflated (8)
    const archive = singleFileZipWithMethod("lazyotp", "compiled-binary", 12);
    expect(() => extractZipBinary(archive, "lazyotp")).toThrow(
      "unsupported ZIP compression method",
    );
  });

  it("throws when the target name is absent and multiple files exist", () => {
    const archive = twoFileZip("other-a", "other-b");
    expect(() => extractZipBinary(archive, "lazyotp")).toThrow("does not contain lazyotp");
  });

  it("throws for an invalid central-directory entry magic number", () => {
    // Corrupt the first byte of the central directory signature
    const archive = singleFileZip("lazyotp", "binary", 8);
    // The central directory starts right after the local file entry.
    // local header = 30 + name.length + compressed.length bytes
    const name = Buffer.from("lazyotp");
    const compressed = deflateRawSync(Buffer.from("binary"));
    const localSize = 30 + name.length + compressed.length;
    const corrupted = Buffer.from(archive);
    corrupted[localSize] = 0xff; // break the 0x02014b50 signature
    expect(() => extractZipBinary(corrupted, "lazyotp")).toThrow("invalid ZIP entry");
  });
});

describe("computeSha256", () => {
  it("computes the hex SHA-256 digest of input data", () => {
    const data = new TextEncoder().encode("hello world");
    expect(computeSha256(data)).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });
});


describe("parseChecksums", () => {
  it("parses standard and bsd style checksum entries", () => {
    const text = [
      "# Release checksums",
      "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9  lazyotp-linux-x64.zip",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *./lazyotp-windows-x64.zip",
      "SHA256 (lazyotp-darwin-arm64.zip) = 1122334455667788990011223344556677889900112233445566778899001122",
      "",
    ].join("\n");
    const parsed = parseChecksums(text);
    expect(parsed.get("lazyotp-linux-x64.zip")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
    expect(parsed.get("lazyotp-windows-x64.zip")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(parsed.get("lazyotp-darwin-arm64.zip")).toBe(
      "1122334455667788990011223344556677889900112233445566778899001122",
    );
  });

  it("handles CRLF line endings", () => {
    const text =
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9  lazyotp-linux-x64.zip\r\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  lazyotp-darwin-arm64.zip\r\n";
    const parsed = parseChecksums(text);
    expect(parsed.size).toBe(2);
    expect(parsed.get("lazyotp-linux-x64.zip")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
    expect(parsed.get("lazyotp-darwin-arm64.zip")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("normalizes forward-slash paths to basename", () => {
    const text =
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9  dist/lazyotp-linux-x64.zip";
    const parsed = parseChecksums(text);
    expect(parsed.get("lazyotp-linux-x64.zip")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("normalizes back-slash paths to basename (BSD style)", () => {
    const text =
      "SHA256 (dist\\lazyotp-windows-x64.zip) = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    const parsed = parseChecksums(text);
    expect(parsed.get("lazyotp-windows-x64.zip")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("returns an empty map for comment-only input", () => {
    const text = "# header\n\n# another comment\n";
    const parsed = parseChecksums(text);
    expect(parsed.size).toBe(0);
  });

  it("skips lines that do not match either checksum format", () => {
    const text = [
      "this is not a checksum line",
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9  lazyotp-linux-x64.zip",
    ].join("\n");
    const parsed = parseChecksums(text);
    expect(parsed.size).toBe(1);
    expect(parsed.get("lazyotp-linux-x64.zip")).toBeTruthy();
  });
});

describe("selectChecksumAsset", () => {
  it("finds checksums.txt in release assets", () => {
    const release: Release = {
      tag_name: "v1.0.0",
      assets: [
        { name: "lazyotp-darwin-arm64.zip", browser_download_url: "https://example.com/darwin" },
        { name: "checksums.txt", browser_download_url: "https://example.com/checksums.txt" },
      ],
    };
    expect(selectChecksumAsset(release)?.name).toBe("checksums.txt");
  });

  it("finds fallback SHA256SUMS or checksums.sha256 assets", () => {
    const release: Release = {
      tag_name: "v1.0.0",
      assets: [
        { name: "lazyotp-darwin-arm64.zip", browser_download_url: "https://example.com/darwin" },
        { name: "SHA256SUMS", browser_download_url: "https://example.com/sha256sums" },
      ],
    };
    expect(selectChecksumAsset(release)?.name).toBe("SHA256SUMS");
  });

  it("falls back to checksums.sha256 when neither checksums.txt nor SHA256SUMS is present", () => {
    const release: Release = {
      tag_name: "v1.0.0",
      assets: [
        {
          name: "checksums.sha256",
          browser_download_url: "https://example.com/checksums.sha256",
        },
      ],
    };
    expect(selectChecksumAsset(release)?.name).toBe("checksums.sha256");
  });

  it("returns undefined when no checksum asset exists", () => {
    const release: Release = {
      tag_name: "v1.0.0",
      assets: [
        { name: "lazyotp-darwin-arm64.zip", browser_download_url: "https://example.com/darwin" },
      ],
    };
    expect(selectChecksumAsset(release)).toBeUndefined();
  });

  it("prefers LAZYOTP_CHECKSUM_ASSET env override when set", () => {
    const release: Release = {
      tag_name: "v1.0.0",
      assets: [
        { name: "checksums.txt", browser_download_url: "https://example.com/checksums.txt" },
        { name: "custom-sums.txt", browser_download_url: "https://example.com/custom-sums.txt" },
      ],
    };
    process.env["LAZYOTP_CHECKSUM_ASSET"] = "custom-sums.txt";
    try {
      expect(selectChecksumAsset(release)?.name).toBe("custom-sums.txt");
    } finally {
      delete process.env["LAZYOTP_CHECKSUM_ASSET"];
    }
  });

  it("returns undefined when LAZYOTP_CHECKSUM_ASSET names an asset that does not exist", () => {
    const release: Release = {
      tag_name: "v1.0.0",
      assets: [
        { name: "checksums.txt", browser_download_url: "https://example.com/checksums.txt" },
      ],
    };
    process.env["LAZYOTP_CHECKSUM_ASSET"] = "missing.txt";
    try {
      expect(selectChecksumAsset(release)).toBeUndefined();
    } finally {
      delete process.env["LAZYOTP_CHECKSUM_ASSET"];
    }
  });
});

describe("verifyChecksum", () => {
  it("succeeds when hash matches", () => {
    const data = new TextEncoder().encode("hello world");
    const hash = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    expect(() => verifyChecksum(data, hash.toUpperCase(), "file.zip")).not.toThrow();
  });

  it("throws when hash does not match", () => {
    const data = new TextEncoder().encode("hello world");
    const mismatch = "0000000000000000000000000000000000000000000000000000000000000000";
    expect(() => verifyChecksum(data, mismatch, "file.zip")).toThrow(
      "Checksum verification failed for file.zip",
    );
  });
});

