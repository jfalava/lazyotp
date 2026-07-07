import type { CliOptions } from "../shared/types.ts";
import { printLine } from "../shared/output.ts";
import { listStoredAliases } from "../shared/secret-store.ts";

export async function commandList(
  args: string[],
  options: CliOptions,
): Promise<void> {
  if (args.length > 0) {
    throw new Error("Usage: lazyotp list [--service <service>]");
  }

  const aliases = await listStoredAliases(options.service);
  if (aliases.length === 0) {
    printLine(`No stored secrets found for service="${options.service}".`);
    return;
  }

  for (const alias of aliases) {
    printLine(alias);
  }
}
