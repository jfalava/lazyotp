import {
  DEFAULT_ALIAS,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  DEFAULT_SERVICE,
} from "../shared/constants.ts";

export function usage(): string {
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
