# lazyotp

Simple OTP CLI that stores secrets in your OS credential manager via `Bun.secrets`:

- macOS: Keychain Services
- Linux: libsecret (GNOME Keyring, KWallet, etc.)
- Windows: Credential Manager

## Install

```bash
bun install
```

## Usage

### Store an OTP secret with an alias

```bash
bun run index.ts set github JBSWY3DPEHPK3PXP
```

You can also pass an `otpauth://...` URL:

```bash
bun run index.ts set aws 'otpauth://totp/MyApp:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MyApp'
```

### Generate a code by alias

```bash
bun run index.ts code github
```

### Pipe a code easily

```bash
bun run index.ts code github | pbcopy
```

### Generate a one-off code without storing

```bash
bun run index.ts code --secret JBSWY3DPEHPK3PXP
```

### Delete a stored alias

```bash
bun run index.ts delete github
```

### Upgrade to the latest release binary

```bash
lazyotp upgrade
```

Optional environment variables for upgrade behavior:

- `LAZYOTP_API_URL` (default: `https://api.github.com/repos/jfalava/lazyotp`)
- `LAZYOTP_BIN_PATH` (default: current executable path)
- `LAZYOTP_UPGRADE_TIMEOUT_MS` (default: `15000`)

### Default alias and custom service

```bash
bun run index.ts set JBSWY3DPEHPK3PXP
bun run index.ts code
bun run index.ts set work JBSWY3DPEHPK3PXP --service company
bun run index.ts code work --service company
```

## Global command

If you want `lazyotp` on your PATH:

```bash
bun link
lazyotp help
```

## Build Binaries

Build for your current platform:

```bash
bun run build
```

Build for all supported targets:

```bash
bun run build:all
```

Target-specific builds:

```bash
bun run build:darwin-arm64
bun run build:darwin-x64
bun run build:linux-arm64
bun run build:linux-x64
bun run build:windows-x64
```

Artifacts are written to `dist/`.
