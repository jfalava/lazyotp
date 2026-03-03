import type { CliOptions } from "../shared/types.ts";
import { extractSecret, looksLikeSecretInput } from "../otp/secret.ts";
import { generateTotp } from "../otp/totp.ts";
import { printLine } from "../shared/output.ts";
import { formatSecretLocation } from "../shared/secret-location.ts";
import { getStoredSecret } from "../shared/secret-store.ts";

function validateCodeArgs(args: string[], options: CliOptions): void {
  if (args.length > 1) {
    throw new Error(
      "Usage: lazyotp code [alias] [--secret <secret|otpauth://...>]",
    );
  }

  if (options.oneOffSecret && args.length > 0) {
    throw new Error("Pass either [alias] or --secret, not both.");
  }
}

function readFallbackSecret(arg?: string): string | null {
  if (!arg || !looksLikeSecretInput(arg)) {
    return null;
  }
  return extractSecret(arg);
}

async function resolveStoredOrFallbackSecret(
  service: string,
  alias: string,
  arg?: string,
): Promise<string | null> {
  const storedSecret = await getStoredSecret(service, alias);
  if (storedSecret) {
    return storedSecret;
  }
  return readFallbackSecret(arg);
}

async function resolveSecret(
  args: string[],
  options: CliOptions,
): Promise<{ alias: string; secret: string | null }> {
  const arg = args[0];
  const alias = arg ?? options.alias;

  if (options.oneOffSecret) {
    return { alias, secret: extractSecret(options.oneOffSecret) };
  }

  return {
    alias,
    secret: await resolveStoredOrFallbackSecret(options.service, alias, arg),
  };
}

function assertSecretExists(
  secret: string | null,
  service: string,
  alias: string,
): string {
  if (!secret) {
    throw new Error(
      `No secret found for ${formatSecretLocation(service, alias)}. Run 'lazyotp set ${alias} <secret>' first.`,
    );
  }
  return secret;
}

export async function commandCode(
  args: string[],
  options: CliOptions,
): Promise<void> {
  validateCodeArgs(args, options);
  const { alias, secret } = await resolveSecret(args, options);
  const resolvedSecret = assertSecretExists(secret, options.service, alias);
  const code = await generateTotp(
    resolvedSecret,
    options.digits,
    options.period,
  );
  printLine(code);
}
