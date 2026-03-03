import type { CliOptions } from "../shared/types.ts";
import { formatSecretLocation } from "../shared/secret-location.ts";
import { printLine } from "../shared/output.ts";
import { deleteStoredSecret } from "../shared/secret-store.ts";

export async function commandDelete(args: string[], options: CliOptions): Promise<void> {
  if (args.length > 1) {
    throw new Error("Usage: lazyotp delete [alias]");
  }

  const alias = args[0] ?? options.alias;
  const deleted = await deleteStoredSecret(options.service, alias);
  if (deleted) {
    printLine(`Deleted stored secret (${formatSecretLocation(options.service, alias)}).`);
  } else {
    printLine(`No secret found to delete (${formatSecretLocation(options.service, alias)}).`);
  }
}
