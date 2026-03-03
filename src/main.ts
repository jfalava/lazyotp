import { parseArgv, readCliOptions } from "./cli/argv.ts";
import { usage } from "./cli/usage.ts";
import { commandCode } from "./commands/code.ts";
import { commandDelete } from "./commands/delete.ts";
import { commandSet } from "./commands/set.ts";
import { printLine } from "./shared/output.ts";
import type { CliOptions, Command } from "./shared/types.ts";

type CommandHandler = (args: string[], options: CliOptions) => Promise<void>;

const COMMAND_HANDLERS: Record<Exclude<Command, "help">, CommandHandler> = {
  set: commandSet,
  code: commandCode,
  delete: commandDelete,
};

async function runCommand(command: Exclude<Command, "help">, args: string[], options: CliOptions): Promise<void> {
  const handler = COMMAND_HANDLERS[command];
  await handler(args, options);
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);

  if (parsed.command === "help") {
    printLine(usage());
    return;
  }

  const options = readCliOptions(parsed.options);
  await runCommand(parsed.command, parsed.positional, options);
}
