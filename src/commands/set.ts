import type { CliOptions } from "../shared/types.ts";
import { extractSecret } from "../otp/secret.ts";
import { formatSecretLocation } from "../shared/secret-location.ts";
import { printLine } from "../shared/output.ts";
import { setStoredSecret } from "../shared/secret-store.ts";

export async function commandSet(args: string[], options: CliOptions): Promise<void> {
  if (args.length === 0 || args.length > 2) {
    throw new Error("Usage: lazyotp set [alias] <secret|otpauth://...>");
  }

  const alias = args.length === 2 ? args[0]! : options.alias;
  const secretInput = args.length === 2 ? args[1]! : args[0]!;
  const secret = extractSecret(secretInput);
  await setStoredSecret(options.service, alias, secret);
  printLine(`Stored OTP secret in OS credential manager (${formatSecretLocation(options.service, alias)}).`);
}
