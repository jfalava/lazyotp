import { createHash } from "node:crypto";
import { chmodSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { CliOptions } from "../shared/types.ts";
import { REPO, VERSION } from "../shared/constants.ts";
import { printLine } from "../shared/output.ts";

declare const Bun: typeof import("bun");

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type Release = {
  tag_name: string;
  assets: ReleaseAsset[];
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

function apiBase(): string {
  return process.env["LAZYOTP_API_URL"] ?? `https://api.github.com/repos/${REPO}`;
}

function binaryPath(): string {
  return process.env["LAZYOTP_BIN_PATH"] ?? process.execPath;
}

function requestTimeoutMs(): number {
  const raw = process.env["LAZYOTP_UPGRADE_TIMEOUT_MS"];
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return parsed;
}

export function assetNameForPlatform(platform: string, arch: string): string | undefined {
  const platformName =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "windows"
          : undefined;
  const architecture = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : undefined;
  return platformName && architecture ? `lazyotp-${platformName}-${architecture}.zip` : undefined;
}

export function binaryNameForPlatform(platform: string): string | undefined {
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    return undefined;
  }
  return platform === "win32" ? "lazyotp.exe" : "lazyotp";
}

function formatErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  return "Unknown error";
}

async function fetchWithTimeout(
  url: string,
  requestLabel: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${requestLabel}: request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${requestLabel}: ${formatErrorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestRelease(timeoutMs: number): Promise<Release> {
  const response = await fetchWithTimeout(
    `${apiBase()}/releases/latest`,
    "Failed to fetch latest release",
    timeoutMs,
    {
      headers: { Accept: "application/vnd.github+json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch latest release: ${response.status}`);
  }
  return (await response.json()) as Release;
}

function selectAssetOrThrow(release: Release): ReleaseAsset {
  const assetName = assetNameForPlatform(process.platform, process.arch);
  if (!assetName) {
    throw new Error(`Unsupported upgrade platform: ${process.platform}/${process.arch}`);
  }
  const asset = release.assets.find((candidate) => candidate.name === assetName);
  if (!asset) {
    const available = release.assets.map((candidate) => candidate.name).join(", ");
    throw new Error(`No binary found for ${assetName}. Available assets: ${available || "(none)"}`);
  }
  return asset;
}

export function selectChecksumAsset(release: Release): ReleaseAsset | undefined {
  const preferredName = process.env["LAZYOTP_CHECKSUM_ASSET"];
  if (preferredName) {
    return release.assets.find((candidate) => candidate.name === preferredName);
  }
  return release.assets.find(
    (candidate) =>
      candidate.name === "checksums.txt" ||
      candidate.name === "SHA256SUMS" ||
      candidate.name === "checksums.sha256",
  );
}

function selectChecksumAssetOrThrow(release: Release): ReleaseAsset {
  const asset = selectChecksumAsset(release);
  if (!asset) {
    throw new Error(
      `No checksum file found in release ${release.tag_name} (expected checksums.txt).`,
    );
  }
  return asset;
}

function normalizeFileName(raw: string): string {
  return raw.split("/").pop()?.split("\\").pop() ?? raw;
}

function parseStandardChecksum(line: string): [string, string] | undefined {
  const match = line.match(/^([a-fA-F0-9]{64})\s+[*]?(\S+)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return [normalizeFileName(match[2]), match[1].toLowerCase()];
}

function parseBsdChecksum(line: string): [string, string] | undefined {
  const match = line.match(/^SHA256\s*\(([^)]+)\)\s*=\s*([a-fA-F0-9]{64})$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return [normalizeFileName(match[1]), match[2].toLowerCase()];
}

function parseChecksumLine(line: string): [string, string] | undefined {
  return parseStandardChecksum(line) ?? parseBsdChecksum(line);
}

export function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const parsed = parseChecksumLine(trimmed);
    if (parsed) {
      checksums.set(parsed[0], parsed[1]);
    }
  }
  return checksums;
}

export function computeSha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function verifyChecksum(
  data: Uint8Array,
  expectedChecksum: string,
  assetName: string,
): void {
  const actualChecksum = computeSha256(data);
  if (actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error(
      `Checksum verification failed for ${assetName}: expected ${expectedChecksum.toLowerCase()}, got ${actualChecksum.toLowerCase()}`,
    );
  }
}

type ZipDirectory = {
  entryCount: number;
  offset: number;
  end: number;
};

type ZipEntry = {
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localFileOffset: number;
  name: string;
  nextOffset: number;
};

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findZipEndOffset(archive: Uint8Array, view: DataView): number {
  const minimumEndRecordSize = 22;
  const maximumCommentSize = 0xffff;
  const searchStart = Math.max(0, archive.length - minimumEndRecordSize - maximumCommentSize);
  for (let offset = archive.length - minimumEndRecordSize; offset >= searchStart; offset -= 1) {
    if (uint32(view, offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Downloaded release is not a valid ZIP archive.");
}

function readZipDirectory(archive: Uint8Array, view: DataView, endOffset: number): ZipDirectory {
  const centralDirectorySize = uint32(view, endOffset + 12);
  const centralDirectoryOffset = uint32(view, endOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd > archive.length) {
    throw new Error("Downloaded release has an invalid ZIP directory.");
  }
  return {
    entryCount: uint16(view, endOffset + 10),
    offset: centralDirectoryOffset,
    end: centralDirectoryEnd,
  };
}

function findZipDirectory(archive: Uint8Array, view: DataView): ZipDirectory {
  const endOffset = findZipEndOffset(archive, view);
  return readZipDirectory(archive, view, endOffset);
}

type ZipEntryBounds = {
  fileNameStart: number;
  fileNameEnd: number;
  nextOffset: number;
};

function readZipEntryBounds(view: DataView, offset: number): ZipEntryBounds {
  const fileNameLength = uint16(view, offset + 28);
  const extraFieldLength = uint16(view, offset + 30);
  const commentLength = uint16(view, offset + 32);
  const fileNameStart = offset + 46;
  const fileNameEnd = fileNameStart + fileNameLength;
  return {
    fileNameStart,
    fileNameEnd,
    nextOffset: fileNameEnd + extraFieldLength + commentLength,
  };
}

function readZipEntry(archive: Uint8Array, view: DataView, offset: number): ZipEntry {
  if (uint32(view, offset) !== 0x02014b50) {
    throw new Error("Downloaded release has an invalid ZIP entry.");
  }
  const bounds = readZipEntryBounds(view, offset);
  if (bounds.nextOffset > archive.length) {
    throw new Error("Downloaded release has a truncated ZIP entry.");
  }
  return {
    compressionMethod: uint16(view, offset + 10),
    compressedSize: uint32(view, offset + 20),
    uncompressedSize: uint32(view, offset + 24),
    localFileOffset: uint32(view, offset + 42),
    name: new TextDecoder().decode(archive.subarray(bounds.fileNameStart, bounds.fileNameEnd)),
    nextOffset: bounds.nextOffset,
  };
}

function readCompressedZipEntry(archive: Uint8Array, view: DataView, entry: ZipEntry): Uint8Array {
  if (uint32(view, entry.localFileOffset) !== 0x04034b50) {
    throw new Error("Downloaded release has an invalid executable entry.");
  }
  const localFileNameLength = uint16(view, entry.localFileOffset + 26);
  const localExtraFieldLength = uint16(view, entry.localFileOffset + 28);
  const dataStart = entry.localFileOffset + 30 + localFileNameLength + localExtraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.length) {
    throw new Error("Downloaded release has a truncated executable entry.");
  }
  return archive.subarray(dataStart, dataEnd);
}

function inflateZipEntry(compressed: Uint8Array, entry: ZipEntry): Uint8Array {
  const binary =
    entry.compressionMethod === 0
      ? compressed
      : entry.compressionMethod === 8
        ? new Uint8Array(inflateRawSync(compressed))
        : undefined;
  if (!binary) {
    throw new Error(
      `Downloaded release uses unsupported ZIP compression method ${entry.compressionMethod}.`,
    );
  }
  if (binary.byteLength !== entry.uncompressedSize) {
    throw new Error("Downloaded release executable size does not match its ZIP entry.");
  }
  return binary;
}

function extractZipEntry(archive: Uint8Array, view: DataView, entry: ZipEntry): Uint8Array {
  const compressed = readCompressedZipEntry(archive, view, entry);
  return inflateZipEntry(compressed, entry);
}

type ZipSearch = {
  expected: ZipEntry | undefined;
  files: ZipEntry[];
};

function searchZipDirectory(
  archive: Uint8Array,
  view: DataView,
  directory: ZipDirectory,
  expectedName: string,
): ZipSearch {
  let offset = directory.offset;
  const files: ZipEntry[] = [];
  for (let entry = 0; entry < directory.entryCount && offset < directory.end; entry += 1) {
    const zipEntry = readZipEntry(archive, view, offset);
    if (zipEntry.name === expectedName) {
      return { expected: zipEntry, files };
    }
    if (!zipEntry.name.endsWith("/")) {
      files.push(zipEntry);
    }
    offset = zipEntry.nextOffset;
  }
  return { expected: undefined, files };
}

function selectZipBinaryEntry(search: ZipSearch, expectedName: string): ZipEntry {
  if (search.expected) {
    return search.expected;
  }
  const [onlyFile] = search.files;
  if (search.files.length === 1 && onlyFile) {
    return onlyFile;
  }
  const available = search.files.map((file) => file.name).join(", ");
  throw new Error(
    `Downloaded release does not contain ${expectedName}; available files: ${available || "none"}.`,
  );
}

export function extractZipBinary(archive: Uint8Array, expectedName: string): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const directory = findZipDirectory(archive, view);
  const search = searchZipDirectory(archive, view, directory, expectedName);
  const entry = selectZipBinaryEntry(search, expectedName);
  return extractZipEntry(archive, view, entry);
}

function platformBinaryName(): string {
  const binaryName = binaryNameForPlatform(process.platform);
  if (!binaryName) {
    throw new Error(`Unsupported upgrade platform: ${process.platform}/${process.arch}`);
  }
  return binaryName;
}

async function fetchChecksumFile(
  asset: ReleaseAsset,
  timeoutMs: number,
): Promise<string> {
  const response = await fetchWithTimeout(
    asset.browser_download_url,
    "Checksum download failed",
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`Checksum download failed: ${response.status}`);
  }
  return await response.text();
}

async function downloadArchive(
  asset: ReleaseAsset,
  expectedChecksum: string,
  timeoutMs: number,
): Promise<Uint8Array> {
  const response = await fetchWithTimeout(asset.browser_download_url, "Download failed", timeoutMs);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const archive = new Uint8Array(await response.arrayBuffer());
  verifyChecksum(archive, expectedChecksum, asset.name);
  return archive;
}

async function writeExtractedBinary(binary: Uint8Array, tmpPath: string): Promise<void> {
  try {
    await writeFile(tmpPath, binary);
    if (process.platform !== "win32") {
      chmodSync(tmpPath, 0o755);
    }
  } catch (error) {
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    throw error;
  }
}

async function downloadToTemp(
  asset: ReleaseAsset,
  expectedChecksum: string,
  tmpPath: string,
  timeoutMs: number,
): Promise<void> {
  const archive = await downloadArchive(asset, expectedChecksum, timeoutMs);
  const binary = extractZipBinary(archive, platformBinaryName());
  await writeExtractedBinary(binary, tmpPath);
}

function replaceBinaryOnWindows(tmpPath: string, targetPath: string): void {
  const helper = Bun.spawn({
    cmd: [
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$target = $env:LAZYOTP_UPGRADE_TARGET; $temp = $env:LAZYOTP_UPGRADE_TEMP; $ownerPid = [int]$env:LAZYOTP_UPGRADE_PID; while (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 100 }; Move-Item -LiteralPath $temp -Destination $target -Force",
    ],
    env: {
      ...process.env,
      LAZYOTP_UPGRADE_TARGET: targetPath,
      LAZYOTP_UPGRADE_TEMP: tmpPath,
      LAZYOTP_UPGRADE_PID: String(process.pid),
    },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  if (!helper.pid) {
    throw new Error("Failed to start Windows upgrade helper.");
  }
}

function replaceBinaryWithRollback(tmpPath: string, targetPath: string): void {
  const backupPath = `${targetPath}.bak`;
  try {
    renameSync(targetPath, backupPath);
    renameSync(tmpPath, targetPath);
    unlinkSync(backupPath);
  } catch (error) {
    if (existsSync(backupPath)) {
      renameSync(backupPath, targetPath);
    }
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    throw error;
  }
}

function replaceBinary(tmpPath: string): void {
  const targetPath = binaryPath();
  if (process.platform === "win32") {
    replaceBinaryOnWindows(tmpPath, targetPath);
    return;
  }
  replaceBinaryWithRollback(tmpPath, targetPath);
}

function ensureUpgradeArgs(args: string[]): void {
  if (args.length > 0) {
    throw new Error("Usage: lazyotp upgrade");
  }
}

function latestVersionFromRelease(release: Release): string {
  return release.tag_name.replace(/^v/, "");
}

async function installLatestRelease(release: Release, timeoutMs: number): Promise<void> {
  const asset = selectAssetOrThrow(release);
  const checksumAsset = selectChecksumAssetOrThrow(release);

  const checksumText = await fetchChecksumFile(checksumAsset, timeoutMs);
  const checksums = parseChecksums(checksumText);
  const expectedChecksum = checksums.get(asset.name);
  if (!expectedChecksum) {
    throw new Error(
      `No checksum found for ${asset.name} in ${checksumAsset.name}.`,
    );
  }

  const tmpPath = `${binaryPath()}.tmp`;
  await downloadToTemp(asset, expectedChecksum, tmpPath, timeoutMs);
  replaceBinary(tmpPath);
}

export async function commandUpgrade(args: string[], _options: CliOptions): Promise<void> {
  ensureUpgradeArgs(args);
  const timeoutMs = requestTimeoutMs();
  const release = await fetchLatestRelease(timeoutMs);
  const latestVersion = latestVersionFromRelease(release);

  if (latestVersion === VERSION) {
    printLine(`Already up to date (${VERSION}).`);
    return;
  }

  await installLatestRelease(release, timeoutMs);

  printLine(`Upgraded lazyotp from ${VERSION} to ${latestVersion}.`);
}
