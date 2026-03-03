import {
  DEFAULT_ALIAS,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  DEFAULT_SERVICE,
} from "../shared/constants.ts";
import type { CliOptions, Command, ParsedArgv } from "../shared/types.ts";

type OptionMap = Record<string, string | boolean>;

type OptionParseResult = {
  parsed: boolean;
  consumed: number;
};

const COMMAND_ALIASES = new Map<string, Command>([
  ["help", "help"],
  ["-h", "help"],
  ["--help", "help"],
  ["set", "set"],
  ["store", "set"],
  ["code", "code"],
  ["gen", "code"],
  ["generate", "code"],
  ["delete", "delete"],
  ["remove", "delete"],
  ["rm", "delete"],
  ["clear", "delete"],
]);

const SHORT_OPTION_MAP: Record<string, string> = {
  s: "service",
  a: "alias",
  n: "name",
  d: "digits",
  p: "period",
};

function normalizeCommand(value?: string): Command {
  if (!value) {
    return "help";
  }

  const normalized = COMMAND_ALIASES.get(value);
  if (normalized) {
    return normalized;
  }

  throw new Error(`Unknown command: ${value}`);
}

function parseLongOption(token: string, next: string | undefined, options: OptionMap): OptionParseResult {
  const eqIndex = token.indexOf("=");
  if (eqIndex >= 0) {
    options[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
    return { parsed: true, consumed: 0 };
  }

  const key = token.slice(2);
  if (!next || next.startsWith("-")) {
    options[key] = true;
    return { parsed: true, consumed: 0 };
  }

  options[key] = next;
  return { parsed: true, consumed: 1 };
}

function parseShortOption(token: string, next: string | undefined, options: OptionMap): OptionParseResult {
  const short = token.slice(1);
  if (short === "h") {
    options.help = true;
    return { parsed: true, consumed: 0 };
  }

  options[resolveShortOptionKey(short)] = readShortOptionValue(short, next);
  return { parsed: true, consumed: 1 };
}

function resolveShortOptionKey(short: string): string {
  const key = SHORT_OPTION_MAP[short];
  if (!key) {
    throw new Error(`Unknown option: -${short}`);
  }
  return key;
}

function readShortOptionValue(short: string, next: string | undefined): string {
  if (!next || next.startsWith("-")) {
    throw new Error(`Missing value for option: -${short}`);
  }
  return next;
}

function parseOptionToken(argv: string[], index: number, options: OptionMap): OptionParseResult {
  const token = argv[index];
  if (!token) {
    return { parsed: false, consumed: 0 };
  }

  if (token.startsWith("--")) {
    return parseLongOption(token, argv[index + 1], options);
  }

  if (token.startsWith("-") && token.length > 1) {
    return parseShortOption(token, argv[index + 1], options);
  }

  return { parsed: false, consumed: 0 };
}

function pushPositionalToken(token: string, positional: string[], commandToken?: string): string {
  if (!commandToken) {
    return token;
  }

  positional.push(token);
  return commandToken;
}

export function parseArgv(argv: string[]): ParsedArgv {
  const { commandToken, positional, options } = parseTokens(argv);
  if (options.help) {
    return { command: "help", positional, options };
  }
  return { command: normalizeCommand(commandToken), positional, options };
}

function parseTokens(argv: string[]): { commandToken?: string; positional: string[]; options: OptionMap } {
  const options: OptionMap = {};
  const positional: string[] = [];
  let commandToken: string | undefined;
  let index = 0;

  while (index < argv.length) {
    const parsedToken = parseTokenAtIndex(argv, index, options, positional, commandToken);
    index = parsedToken.nextIndex;
    commandToken = parsedToken.commandToken;
  }

  return { commandToken, positional, options };
}

function parseTokenAtIndex(
  argv: string[],
  index: number,
  options: OptionMap,
  positional: string[],
  commandToken?: string,
): { nextIndex: number; commandToken?: string } {
  const optionResult = parseOptionToken(argv, index, options);
  if (optionResult.parsed) {
    return { nextIndex: index + optionResult.consumed + 1, commandToken };
  }

  const token = argv[index];
  if (!token) {
    return { nextIndex: index + 1, commandToken };
  }

  return {
    nextIndex: index + 1,
    commandToken: pushPositionalToken(token, positional, commandToken),
  };
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer`);
  }
  return parsed;
}

function readStringOption(options: OptionMap, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function readOptionalSecret(options: OptionMap): string | undefined {
  if (typeof options.secret === "boolean") {
    throw new Error("--secret requires a value");
  }
  return readStringOption(options, "secret");
}

function readAlias(options: OptionMap): string {
  const alias = (readStringOption(options, "alias") ?? readStringOption(options, "name") ?? DEFAULT_ALIAS).trim();
  if (!alias) {
    throw new Error("--alias must not be empty");
  }
  return alias;
}

function readPositiveIntOption(options: OptionMap, key: string, fallback: number): number {
  const value = readStringOption(options, key);
  if (!value) {
    return fallback;
  }
  return parsePositiveInt(value, key);
}

function readDigits(options: OptionMap): number {
  const digits = readPositiveIntOption(options, "digits", DEFAULT_DIGITS);
  if (digits > 10) {
    throw new Error("--digits must be <= 10");
  }
  return digits;
}

export function readCliOptions(options: OptionMap): CliOptions {
  return {
    service: readStringOption(options, "service") ?? DEFAULT_SERVICE,
    alias: readAlias(options),
    oneOffSecret: readOptionalSecret(options),
    digits: readDigits(options),
    period: readPositiveIntOption(options, "period", DEFAULT_PERIOD),
  };
}
