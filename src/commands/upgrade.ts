import { chmodSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { CliOptions } from "../shared/types.ts";
import { REPO, VERSION } from "../shared/constants.ts";
import { printLine } from "../shared/output.ts";

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type Release = {
  tag_name: string;
  assets: ReleaseAsset[];
};

const API_BASE =
  process.env["LAZYOTP_API_URL"] ?? `https://api.github.com/repos/${REPO}`;
const BIN_PATH = process.env["LAZYOTP_BIN_PATH"] ?? process.execPath;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

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

function getPlatformAssetName(): string {
  const platform = (() => {
    if (process.platform === "darwin") {
      return "darwin";
    }
    if (process.platform === "linux") {
      return "linux";
    }
    if (process.platform === "win32") {
      return "windows";
    }
    throw new Error(`Unsupported platform for upgrade: ${process.platform}`);
  })();

  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const suffix = platform === "windows" ? ".exe" : "";
  return `lazyotp-${platform}-${arch}${suffix}`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
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
      throw new Error(
        `${requestLabel}: request timed out after ${timeoutMs}ms`,
      );
    }
    throw new Error(`${requestLabel}: ${formatErrorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestRelease(timeoutMs: number): Promise<Release> {
  const response = await fetchWithTimeout(
    `${API_BASE}/releases/latest`,
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
  const assetName = getPlatformAssetName();
  const asset = release.assets.find(
    (candidate) => candidate.name === assetName,
  );
  if (!asset) {
    const available = release.assets
      .map((candidate) => candidate.name)
      .join(", ");
    throw new Error(
      `No binary found for ${assetName}. Available assets: ${available || "(none)"}`,
    );
  }
  return asset;
}

async function downloadToTemp(
  asset: ReleaseAsset,
  tmpPath: string,
  timeoutMs: number,
): Promise<void> {
  const response = await fetchWithTimeout(
    asset.browser_download_url,
    "Download failed",
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  await writeFile(tmpPath, buffer);
  chmodSync(tmpPath, 0o755);
}

function replaceBinary(tmpPath: string): void {
  const backupPath = `${BIN_PATH}.bak`;

  try {
    renameSync(BIN_PATH, backupPath);
    renameSync(tmpPath, BIN_PATH);
    unlinkSync(backupPath);
  } catch (error) {
    if (existsSync(backupPath)) {
      renameSync(backupPath, BIN_PATH);
    }
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    throw error;
  }
}

function ensureUpgradeArgs(args: string[]): void {
  if (args.length > 0) {
    throw new Error("Usage: lazyotp upgrade");
  }
}

function latestVersionFromRelease(release: Release): string {
  return release.tag_name.replace(/^v/, "");
}

async function installLatestRelease(
  release: Release,
  timeoutMs: number,
): Promise<void> {
  const asset = selectAssetOrThrow(release);
  const tmpPath = `${BIN_PATH}.tmp`;
  await downloadToTemp(asset, tmpPath, timeoutMs);
  replaceBinary(tmpPath);
}

export async function commandUpgrade(
  args: string[],
  _options: CliOptions,
): Promise<void> {
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
