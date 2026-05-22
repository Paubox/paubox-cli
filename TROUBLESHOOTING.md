# Troubleshooting Guide

This guide helps diagnose and resolve common issues with the Paubox CLI.

## Debug Data Collection

When reporting issues to Support, collect the following information:

### Required Information

1. **CLI version**: `paubox --version`
2. **Node.js version**: `node --version`
3. **Operating system and version**:
   - macOS: `sw_vers`
   - Linux: `cat /etc/os-release`
   - Windows: `winver` (run in dialog) or `systeminfo | findstr /B /C:"OS"`
4. **Installation method**: npm, Homebrew, or winget
5. **Credential storage method**: Run `paubox auth status` to see "OS keychain" or "config file"

### Verbose Output

Use the `--verbose` flag to capture detailed request/response information:

```bash
paubox send --to user@example.com --subject "Test" --text "Hello" --verbose 2>&1 | tee paubox-debug.log
```

The verbose output shows:
- Full request URL and method
- Request headers (with API key redacted)
- Request body (with large payloads truncated)
- Response status and timing
- Response headers and body

**Note:** Always review verbose output before sharing — while API keys are redacted, the output may contain email addresses or message content.

## Installation Issues

### npm

#### Permission Errors (EACCES)

```
npm ERR! Error: EACCES: permission denied
```

**Do not use `sudo npm install -g`**. Instead, fix npm permissions:

```bash
# Option 1: Change npm's default directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc  # or ~/.zshrc
source ~/.bashrc

# Option 2: Use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
npm install -g paubox
```

#### Node.js Version Too Old

```
error paubox@x.x.x: The engine "node" is incompatible with this module.
```

Paubox CLI requires Node.js 20.12.0 or later. Update Node.js:

```bash
# Using nvm
nvm install 20
nvm use 20

# Using Homebrew (macOS)
brew upgrade node

# Using package manager (Linux)
# See https://nodejs.org/en/download/package-manager
```

#### Native Module Build Failures

If you see errors about `keytar` or native modules failing to build:

**Linux**: Install libsecret development headers:
```bash
# Debian/Ubuntu
sudo apt-get install libsecret-1-dev

# Fedora
sudo dnf install libsecret-devel

# Arch
sudo pacman -S libsecret
```

**Windows**: Install Visual C++ Build Tools:
```powershell
npm install -g windows-build-tools
# Or install Visual Studio Build Tools manually
```

**Fallback**: If native modules cannot be built, the CLI will automatically fall back to file-based credential storage with restricted permissions (0600).

### Homebrew (macOS)

#### Formula Not Found

```
Error: No formulae or casks found for paubox
```

Add the Paubox tap first:
```bash
brew tap paubox/paubox
brew install paubox
```

#### Outdated Formula

```bash
brew update
brew upgrade paubox
```

#### Homebrew Installation Conflicts

If you have both npm and Homebrew installations:
```bash
# Check which paubox is in PATH
which paubox

# Remove npm global install
npm uninstall -g paubox

# Or remove Homebrew install
brew uninstall paubox
```

### winget (Windows)

#### Package Not Found

```
No package found matching input criteria.
```

Update winget sources:
```powershell
winget source update
```

#### Installation Hangs

If installation appears stuck, check if another winget process is running:
```powershell
Get-Process -Name winget -ErrorAction SilentlyContinue | Stop-Process
winget install paubox
```

## Uninstallation / Manual Removal

### npm

```bash
npm uninstall -g paubox
```

If the above fails or leaves artifacts:
```bash
# Find installation location
npm root -g

# Manually remove (adjust path as needed)
rm -rf /usr/local/lib/node_modules/paubox
rm -f /usr/local/bin/paubox
```

### Homebrew

```bash
brew uninstall paubox
brew untap paubox/paubox  # Optional: remove tap
```

### winget

```powershell
winget uninstall paubox
```

### Credential Cleanup

After uninstalling, you may want to remove stored credentials:

**macOS/Linux (keychain)**:
```bash
# macOS
security delete-generic-password -s paubox-cli

# Linux (GNOME Keyring)
secret-tool clear service paubox-cli
```

**All platforms (config file fallback)**:
```bash
# macOS/Linux
rm -rf ~/.config/paubox

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:APPDATA\paubox"
```

## Authentication Issues

### "Not authenticated" Error

```
Error: Not authenticated.
```

Run `paubox auth login` and enter your API username (endpoint name) and API key from the Paubox dashboard.

### "Authentication failed" Error

```
Error: Authentication failed.
Hint: Check your API credentials...
```

1. Verify credentials in the Paubox dashboard
2. Check that the API username matches your endpoint name exactly
3. Ensure the API key has not been rotated
4. Run `paubox auth login` to re-enter credentials

### Keychain Access Denied (macOS)

If prompted repeatedly for keychain access:

1. Open Keychain Access.app
2. Find "paubox-cli" in the login keychain
3. Right-click > Get Info > Access Control
4. Add Terminal.app (or your terminal emulator) to "Always allow access"

Alternatively, force fallback to file storage:
```bash
# Set environment variable
export PAUBOX_NO_KEYCHAIN=1
paubox auth login
```

### Keyring Unavailable (Linux)

If you see errors about keyring/libsecret:

1. Ensure a keyring daemon is running (GNOME Keyring, KWallet)
2. For headless servers, use the config file fallback (automatic if keytar fails)
3. Ensure `libsecret-1-dev` is installed

## Network Issues

### Connection Timeout

```
Error: fetch failed
```

1. Check internet connectivity
2. Verify no firewall is blocking `api.paubox.net` (port 443)
3. If behind a proxy, configure Node.js to use it:
   ```bash
   export HTTPS_PROXY=http://proxy.example.com:8080
   paubox send ...
   ```

### SSL/Certificate Errors

```
Error: unable to verify the first certificate
```

This usually indicates a corporate proxy performing SSL inspection. Options:

1. Add your corporate CA certificate to Node.js:
   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem
   ```

2. For testing only (not recommended for production):
   ```bash
   export NODE_TLS_REJECT_UNAUTHORIZED=0
   ```

## Common API Errors

### 400 Bad Request

Check that:
- Email addresses are valid
- Subject is provided
- At least one of `--text` or `--html` is provided

Use `--verbose` to see the exact error message from the API.

### 401 Unauthorized

Re-authenticate: `paubox auth login`

### 413 Payload Too Large

Reduce attachment sizes. Total request size must not exceed limits (check Paubox documentation for current limits).

### 422 Unprocessable Entity

For forms: Check that field names match the form definition exactly. Use `paubox forms get <formId>` to verify the form structure.

## Getting Help

If you've collected the debug information above and still need help:

1. Check the [GitHub Issues](https://github.com/paubox/paubox-cli/issues) for similar problems
2. Contact Paubox Support with:
   - Debug output from `--verbose`
   - CLI version, Node.js version, and OS
   - Steps to reproduce the issue
