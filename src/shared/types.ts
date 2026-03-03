export type Command = "set" | "code" | "delete" | "help";

export interface ParsedArgv {
  command: Command;
  positional: string[];
  options: Record<string, string | boolean>;
}

export interface CliOptions {
  service: string;
  alias: string;
  oneOffSecret?: string;
  digits: number;
  period: number;
}
