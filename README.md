# paubox-cli

Official CLI for the [Paubox](https://www.paubox.com) encrypted email API. Send HIPAA-compliant email, check delivery status, and manage your credentials from the terminal.

## Installation

### npm (all platforms)

```bash
npm install -g paubox-cli
```

### Homebrew (macOS)

```bash
brew tap paubox/paubox
brew install paubox-cli
```

### Requirements

- Node.js ≥ 20.12.0
- On Linux: `libsecret-1-dev` is required for OS keychain support
  ```bash
  sudo apt-get install libsecret-1-dev
  ```
  Without it, credentials fall back to `~/.config/paubox/config.json` automatically.

## Quick Start

```bash
# Authenticate with your Paubox API credentials
paubox auth login

# Send an email
paubox send --to recipient@example.com --from you@yourdomain.com --subject "Hello" --text "Hi there!"

# Check delivery status
paubox status <trackingId>
```

## Commands

### `paubox auth`

Manage Paubox API credentials.

```bash
paubox auth login     # Prompt for API username and key; validate and store
paubox auth logout    # Remove stored credentials
paubox auth status    # Show current authentication state
```

Credentials are stored in the OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service) when available. If the keychain is unavailable, they fall back to `~/.config/paubox/config.json` with `0600` permissions.

---

### `paubox send`

Send a secure email.

```bash
paubox send \
  --to recipient@example.com \
  --from sender@yourdomain.com \
  --subject "Your subject" \
  --text "Plain text body" \
  --html "<p>HTML body</p>" \
  --attachment /path/to/file.pdf
```

| Flag | Required | Description |
|------|----------|-------------|
| `--to <email...>` | Yes | Recipient(s). Repeat for multiple: `--to a@b.com --to c@d.com` |
| `--from <email>` | No* | Sender address. Defaults to `defaultFrom` config value |
| `--subject <text>` | Yes | Email subject |
| `--text <body>` | No† | Plain text body |
| `--html <body>` | No† | HTML body |
| `--attachment <file...>` | No | File path(s) to attach |

† At least one of `--text` or `--html` is required.

On success, prints the source tracking ID:
```
✓ Email sent. Tracking ID: abc123-def456
```

---

### `paubox status`

Check the delivery status of a sent email.

```bash
paubox status <trackingId>
```

Outputs a table of recipients with delivery status and timestamps:

```
recipient              status     delivered at              opened  opened at
---------------------  ---------  ------------------------  ------  ---------
to@example.com         delivered  2026-01-01T12:00:00Z      opened  2026-01-01T13:00:00Z
```

---

### `paubox config`

Manage CLI configuration stored in `~/.config/paubox/config.json`.

```bash
paubox config set defaultFrom sender@yourdomain.com
paubox config get defaultFrom
paubox config list
paubox config reset
```

| Key | Description |
|-----|-------------|
| `defaultFrom` | Default sender address used when `--from` is omitted |

---

## Global Options

These flags work with any command:

| Flag | Description |
|------|-------------|
| `--json` | Output result as JSON (useful for scripting) |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --version` | Print version |
| `--help` | Show help |

### JSON output example

```bash
paubox --json send --to to@example.com --from from@example.com --subject Hi --text Hello
# {"sourceTrackingId":"abc123-def456"}
```

---

## Homebrew Tap Setup

After publishing to npm, create the Homebrew tap in a separate repository named `homebrew-paubox`:

```
homebrew-paubox/
└── Formula/
    └── paubox-cli.rb
```

```ruby
class PauboxCli < Formula
  desc "Official CLI for the Paubox encrypted email API"
  homepage "https://github.com/paubox/paubox-cli"
  url "https://registry.npmjs.org/paubox-cli/-/paubox-cli-0.1.0.tgz"
  sha256 "<sha256 of the npm tarball>"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/paubox"
  end

  test do
    assert_match "paubox", shell_output("#{bin}/paubox --version")
  end
end
```

To get the SHA256: `curl -s https://registry.npmjs.org/paubox-cli/0.1.0 | jq -r .dist.shasum`

---

## Development

```bash
git clone https://github.com/paubox/paubox-cli.git
cd paubox-cli
npm install
npm test          # Run tests
npm run lint      # Lint
npm run build     # Compile TypeScript
npm run dev -- auth status  # Run without building
```

### Project structure

```
src/
  commands/       auth, send, status, config command handlers
  lib/            api client, credential storage, config store, output helpers
  index.ts        CLI entry point (exports createProgram())
bin/
  paubox.js       Shebang wrapper (ships in npm package)
test/             Jest unit tests mirroring src/ structure
```

## License

Apache 2.0 — see [LICENSE](LICENSE)
