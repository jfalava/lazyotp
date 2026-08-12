import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assetNameForPlatform,
  binaryNameForPlatform,
  extractZipBinary,
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
  const local = localEntryHeader(
    encodedName,
    compressed,
    binary.length,
    method,
  );
  const central = centralEntryHeader(
    encodedName,
    compressed,
    binary.length,
    method,
  );
  return Buffer.concat([
    local,
    central,
    endRecord(central.length, local.length),
  ]);
}

describe("upgrade release names", () => {
  it("uses zipped platform and architecture assets", () => {
    expect(assetNameForPlatform("darwin", "arm64")).toBe(
      "lazyotp-darwin-arm64.zip",
    );
    expect(assetNameForPlatform("linux", "x64")).toBe("lazyotp-linux-x64.zip");
    expect(assetNameForPlatform("win32", "x64")).toBe(
      "lazyotp-windows-x64.zip",
    );
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
    expect(() =>
      extractZipBinary(Buffer.from("not-an-archive"), "lazyotp"),
    ).toThrow("not a valid ZIP archive");
  });
});
