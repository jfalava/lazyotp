# lazyotp

Simple OTP CLI that stores secrets in your OS credential manager via `Bun.secrets`:

- macOS: Keychain Services
- Linux: `libsecret`
- Windows: Credential Manager

## Install

Check the [latest](https://github.com/jfalava/lazyotp/releases) release and download the version compatible with your platform.

### macOS Gatekeeper

macOS may quarantine a binary downloaded through a browser and report that
`lazyotp` is damaged, cannot be opened, or was killed. Remove the quarantine
attribute from the installed binary:

```bash
lazyotp_path="$(command -v lazyotp)"
xattr -d com.apple.quarantine "$lazyotp_path"
chmod 755 "$lazyotp_path"
```

If macOS still blocks it, apply an ad-hoc signature and clear the quarantine
attribute again:

```bash
lazyotp_path="$(command -v lazyotp)"
codesign --force --sign - "$lazyotp_path"
xattr -d com.apple.quarantine "$lazyotp_path"
```

## Usage

### Store an OTP secret with an alias

```bash
lazyotp set github AAAABBBBCCCCDDD
```

You can also pass an `otpauth://...` URL:

```bash
lazyotp set aws 'otpauth://totp/MyApp:user@example.com?secret=AAAABBBBCCCCDDD&issuer=MyApp'
```

### Generate a code by alias

```bash
lazyotp code github
```

### Pipe a code easily

```bash
lazyotp code github | pbcopy
```

### Generate a one-off code without storing

```bash
lazyotp code --secret AAAABBBBCCCCDDD
```

### Delete a stored alias

```bash
lazyotp delete github
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
lazyotp set AAAABBBBCCCCDDD
lazyotp code
lazyotp set work AAAABBBBCCCCDDD --service company
lazyotp code work --service company
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
bun install
```

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
