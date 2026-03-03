#!/usr/bin/env bun

type Command = "set" | "code" | "delete" | "help";

interface ParsedArgv {
  command: Command;
  positional: string[];
  options: Record<string, string | boolean>;
}

interface CliOptions {
  service: string;
  alias: string;
  oneOffSecret?: string;
  digits: number;
  period: number;
}

const DEFAULT_SERVICE = "lazyotp";
const DEFAULT_ALIAS = "default";
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;

function usage(): string {
  return `
lazyotp - Generate OTP codes using Bun Secrets

Usage:
  lazyotp set [alias] <secret|otpauth://...> [--service <service>] [--alias <alias>]
  lazyotp code [alias] [--service <service>] [--digits <n>] [--period <n>]
  lazyotp code --secret <secret|otpauth://...> [--digits <n>] [--period <n>]
  lazyotp delete [alias] [--service <service>] [--alias <alias>]
  lazyotp help

Commands:
  set       Store OTP secret in OS credential manager (Keychain/libsecret/Credential Manager)
  code      Generate current TOTP code (from stored secret, or one-off secret argument)
  delete    Delete stored secret
  help      Show this help message

Options:
  -s, --service <service>  Credential service name (default: "${DEFAULT_SERVICE}")
  -a, --alias <alias>      Entry alias (default: "${DEFAULT_ALIAS}")
  -n, --name <name>        Backward-compatible alias option (same as --alias)
      --secret <secret>    One-off secret for code generation without storing
  -d, --digits <n>         OTP digits (default: ${DEFAULT_DIGITS})
  -p, --period <n>         OTP period in seconds (default: ${DEFAULT_PERIOD})
  -h, --help               Show help

Examples:
  bun run index.ts set github JBSWY3DPEHPK3PXP
  bun run index.ts code github | pbcopy
  bun run index.ts code --secret JBSWY3DPEHPK3PXP
  bun run index.ts delete github
`.trim();
}

function normalizeCommand(value?: string): Command {
  if (!value || value === "help" || value === "-h" || value === "--help") {
    return "help";
  }

  if (value === "set" || value === "store") {
    return "set";
  }

  if (value === "code" || value === "gen" || value === "generate") {
    return "code";
  }

  if (value === "delete" || value === "remove" || value === "rm" || value === "clear") {
    return "delete";
  }

  throw new Error(`Unknown command: ${value}`);
}

function parseArgv(argv: string[]): ParsedArgv {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let commandToken: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) {
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex >= 0) {
        options[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
        continue;
      }

      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const short = token.slice(1);
      if (short === "h") {
        options.help = true;
        continue;
      }

      const map: Record<string, string> = {
        s: "service",
        a: "alias",
        n: "name",
        d: "digits",
        p: "period",
      };

      const key = map[short];
      if (!key) {
        throw new Error(`Unknown option: -${short}`);
      }

      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing value for option: -${short}`);
      }

      options[key] = value;
      i += 1;
      continue;
    }

    if (!commandToken) {
      commandToken = token;
    } else {
      positional.push(token);
    }
  }

  if (options.help) {
    return { command: "help", positional, options };
  }

  return {
    command: normalizeCommand(commandToken),
    positional,
    options,
  };
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer`);
  }
  return parsed;
}

function readCliOptions(options: Record<string, string | boolean>): CliOptions {
  const service = typeof options.service === "string" ? options.service : DEFAULT_SERVICE;
  const aliasFromFlags = typeof options.alias === "string" ? options.alias : undefined;
  const legacyName = typeof options.name === "string" ? options.name : undefined;
  const alias = (aliasFromFlags ?? legacyName ?? DEFAULT_ALIAS).trim();
  const oneOffSecret = typeof options.secret === "string" ? options.secret : undefined;
  const digits =
    typeof options.digits === "string" ? parsePositiveInt(options.digits, "digits") : DEFAULT_DIGITS;
  const period =
    typeof options.period === "string" ? parsePositiveInt(options.period, "period") : DEFAULT_PERIOD;

  if (typeof options.secret === "boolean") {
    throw new Error("--secret requires a value");
  }

  if (alias.length === 0) {
    throw new Error("--alias must not be empty");
  }

  if (digits > 10) {
    throw new Error("--digits must be <= 10");
  }

  return { service, alias, oneOffSecret, digits, period };
}

function extractSecret(input: string): string {
  if (!input.startsWith("otpauth://")) {
    return input;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid otpauth URL");
  }

  const secret = url.searchParams.get("secret");
  if (!secret) {
    throw new Error("otpauth URL is missing the 'secret' query parameter");
  }

  return secret;
}

function looksLikeSecretInput(input: string): boolean {
  if (input.startsWith("otpauth://")) {
    return true;
  }

  const normalized = input.toUpperCase().replace(/[\s-]/g, "");
  return normalized.length >= 16 && /^[A-Z2-7]+=*$/.test(normalized);
}

function decodeBase32(raw: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const input = raw.toUpperCase().replace(/[\s-]/g, "");

  if (input.length === 0) {
    throw new Error("Secret cannot be empty");
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of input) {
    if (char === "=") {
      break;
    }

    const idx = alphabet.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character in secret: ${char}`);
    }

    value = (value << 5) | idx;
    bits += 5;

    while (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  if (bytes.length === 0) {
    throw new Error("Secret did not decode to any bytes");
  }

  return new Uint8Array(bytes);
}

async function generateTotp(secret: string, digits: number, period: number): Promise<string> {
  const keyBytes = decodeBase32(secret);
  const keyMaterial = Uint8Array.from(keyBytes);
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  view.setBigUint64(0, BigInt(counter), false);

  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuffer));
  const tail = hmac[hmac.length - 1];
  if (tail === undefined) {
    throw new Error("Failed to compute HMAC digest");
  }
  const offset = tail & 0x0f;
  if (offset + 3 >= hmac.length) {
    throw new Error("Failed to compute OTP from digest");
  }

  const b0 = hmac[offset];
  const b1 = hmac[offset + 1];
  const b2 = hmac[offset + 2];
  const b3 = hmac[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Error("Failed to compute OTP bytes");
  }

  const binary =
    ((b0 & 0x7f) << 24) |
    (b1 << 16) |
    (b2 << 8) |
    b3;

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

function formatSecretLocation(service: string, alias: string): string {
  return `service="${service}", alias="${alias}"`;
}

function isInteractionNotAllowedError(error: unknown): boolean {
  const raw = String(error ?? "");
  return raw.includes("ERR_SECRETS_INTERACTION_NOT_ALLOWED");
}

async function commandSet(args: string[], options: CliOptions): Promise<void> {
  if (args.length === 0 || args.length > 2) {
    throw new Error("Usage: lazyotp set [alias] <secret|otpauth://...>");
  }

  const alias = args.length === 2 ? args[0]! : options.alias;
  const secretInput = args.length === 2 ? args[1]! : args[0]!;
  const secret = extractSecret(secretInput);
  await Bun.secrets.set({
    service: options.service,
    name: alias,
    value: secret,
  });
  console.log(`Stored OTP secret in OS credential manager (${formatSecretLocation(options.service, alias)}).`);
}

async function commandCode(args: string[], options: CliOptions): Promise<void> {
  if (args.length > 1) {
    throw new Error("Usage: lazyotp code [alias] [--secret <secret|otpauth://...>]");
  }

  if (options.oneOffSecret && args.length > 0) {
    throw new Error("Pass either [alias] or --secret, not both.");
  }

  const arg = args[0];
  const alias = arg ?? options.alias;
  let secret: string | null;

  if (options.oneOffSecret) {
    secret = extractSecret(options.oneOffSecret);
  } else {
    secret = await Bun.secrets.get({
      service: options.service,
      name: alias,
    });

    // Backward compatibility: if no alias exists and argument looks like a secret,
    // treat it as one-off input.
    if (!secret && arg && looksLikeSecretInput(arg)) {
      secret = extractSecret(arg);
    }
  }

  if (!secret) {
    throw new Error(
      `No secret found for ${formatSecretLocation(options.service, alias)}. Run 'lazyotp set ${alias} <secret>' first.`,
    );
  }

  const code = await generateTotp(secret, options.digits, options.period);
  console.log(code);
}

async function commandDelete(args: string[], options: CliOptions): Promise<void> {
  if (args.length > 1) {
    throw new Error("Usage: lazyotp delete [alias]");
  }

  const alias = args[0] ?? options.alias;
  const deleted = await Bun.secrets.delete({
    service: options.service,
    name: alias,
  });
  if (deleted) {
    console.log(`Deleted stored secret (${formatSecretLocation(options.service, alias)}).`);
  } else {
    console.log(`No secret found to delete (${formatSecretLocation(options.service, alias)}).`);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgv(Bun.argv.slice(2));

  if (parsed.command === "help") {
    console.log(usage());
    return;
  }

  const options = readCliOptions(parsed.options);

  if (parsed.command === "set") {
    await commandSet(parsed.positional, options);
    return;
  }

  if (parsed.command === "code") {
    await commandCode(parsed.positional, options);
    return;
  }

  if (parsed.command === "delete") {
    await commandDelete(parsed.positional, options);
    return;
  }
}

await main().catch((error: unknown) => {
  if (isInteractionNotAllowedError(error)) {
    console.error(
      "Error: Bun Secrets could not access the OS credential manager in this environment. " +
        "Run this CLI in a normal local terminal session with Keychain/libsecret/Credential Manager access.",
    );
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
