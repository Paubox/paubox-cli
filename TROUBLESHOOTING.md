# Troubleshooting Guide

This document is for Support and Engineering teams troubleshooting paubox-cli issues.

## Collecting Debug Information

### Using Verbose Mode

Add `--verbose` to any command to see detailed request/response information:

```bash
paubox --verbose send --to test@example.com --from sender@domain.com --subject "Test" --text "Hello"
```

Verbose output includes:
- CLI version, Node.js version, and platform
- Full HTTP request details (URL, method, headers with redacted API key)
- Full HTTP response details (status code, body)

**Note:** Verbose output goes to stderr so it won't interfere with `--json` output.

### Baseline Data to Collect

When escalating an issue to Engineering, collect:

1. **CLI version and environment:**
   ```bash
   paubox --version
   node --version
   ```

2. **Operating system:**
   - macOS: `sw_vers`
   - Linux: `cat /etc/os-release`
   - Windows: `systeminfo | findstr /B /C:"OS"`

3. **Installation method:** npm, Homebrew, or winget

4. **Credential storage in use:**
   ```bash
   paubox auth status
   ```
   Shows whether using "OS keychain" or "config file"

5. **Verbose output of the failing command** (see above)

6. **Full terminal output** including any error messages and hints

---

## Installation Troubleshooting

### npm

#### Common Issues

**Permission denied (EACCES)**
```
npm ERR! Error: EACCES: permission denied
```
**Fix:** Use a Node version manager (nvm, fnm) or fix npm permissions:
```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH  # add to shell profile
npm install -g paubox-cli
```

**keytar native build fails**
```
npm ERR! node-pre-gyp ERR! build error
```
This is **not a critical error**. The CLI falls back to config file storage automatically. To enable OS keychain:
- **macOS:** Install Xcode Command Line Tools: `xcode-select --install`
- **Linux:** Install libsecret: `sudo apt-get install libsecret-1-dev`
- **Windows:** Install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

**Node.js version too old**
```
error paubox-cli@x.x.x: The engine "node" is incompatible with this module.
```
**Fix:** Upgrade to Node.js 20.12.0 or later.

**Network/proxy issues**
```
npm ERR! network request to https://registry.npmjs.org failed
```
**Fix:** Configure npm proxy if behind corporate firewall:
```bash
npm config set proxy http://proxy.example.com:8080
npm config set https-proxy http://proxy.example.com:8080
```

### Homebrew (macOS)

#### Common Issues

**Tap not found**
```
Error: paubox/paubox was not found
```
**Fix:**
```bash
brew tap paubox/paubox
brew install paubox-cli
```

**Outdated Homebrew**
```
Error: Your Homebrew is outdated
```
**Fix:**
```bash
brew update
brew install paubox-cli
```

**Node dependency missing**
```
Error: paubox-cli: node is required
```
**Fix:**
```bash
brew install node
brew install paubox-cli
```

**Formula conflicts**
**Fix:**
```bash
brew unlink paubox-cli
brew link --overwrite paubox-cli
```

### winget (Windows)

#### Common Issues

**Package not found**
```
No package found matching input criteria
```
**Fix:** Update winget sources:
```powershell
winget source update
winget install Paubox.CLI
```

**Installation blocked by policy**
```
Installation failed due to policy restrictions
```
**Fix:** Contact IT administrator or use npm installation instead.

**Old winget version**
**Fix:** Update App Installer from Microsoft Store.

---

## Uninstallation / Manual Removal

### npm (all platforms)

```bash
npm uninstall -g paubox-cli
```

**Manual cleanup if needed:**
```bash
# Find global npm prefix
npm config get prefix

# Remove manually (example paths)
rm -f /usr/local/bin/paubox           # or ~/.npm-global/bin/paubox
rm -rf /usr/local/lib/node_modules/paubox-cli
```

### Homebrew (macOS)

```bash
brew uninstall paubox-cli
brew untap paubox/paubox  # optional: remove tap
```

**Manual cleanup if needed:**
```bash
rm -f /opt/homebrew/bin/paubox  # Apple Silicon
rm -f /usr/local/bin/paubox     # Intel Mac
```

### winget (Windows)

```powershell
winget uninstall Paubox.CLI
```

**Manual cleanup if needed:**
1. Delete from `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Paubox.CLI*`
2. Remove from PATH if manually added

### Credential Cleanup (all platforms)

**Remove stored credentials:**
```bash
paubox auth logout
```

**Manual credential removal:**

| Platform | Keychain Location |
|----------|-------------------|
| macOS | Keychain Access → search "paubox-cli" → delete entry |
| Windows | Credential Manager → Windows Credentials → search "paubox-cli" |
| Linux | Seahorse (GNOME Keyring) → search "paubox-cli" |

**Config file fallback location:**
- Linux/macOS: `~/.config/paubox/config.json`
- Windows: `%APPDATA%\paubox\config.json`

To remove manually:
```bash
# Linux/macOS
rm -rf ~/.config/paubox

# Windows (PowerShell)
Remove-Item -Recurse "$env:APPDATA\paubox"
```

---

## Runtime Errors

### Authentication Errors

**"Not authenticated"**
```
✗ Not authenticated.
  Hint: Run `paubox auth login` to authenticate.
```
**Fix:** Run `paubox auth login` and enter API credentials.

**"Authentication failed" (401)**
```
✗ Authentication failed.
  Hint: Check your API credentials with `paubox auth status` or re-run `paubox auth login`.
```
**Causes:**
- Invalid API key
- API key revoked or expired
- Wrong API username (endpoint name)

**Fix:** Verify credentials in Paubox dashboard and re-run `paubox auth login`.

**"Credentials are invalid" during login**
**Causes:**
- Typo in API username or key
- Copy/paste added whitespace
- API not provisioned for this endpoint

**Fix:** Double-check credentials in Paubox dashboard. Ensure no leading/trailing spaces.

### Network Errors

**"fetch failed" or "ECONNREFUSED"**
```
✗ Send failed: fetch failed
```
**Causes:**
- No internet connection
- Firewall blocking api.paubox.net
- DNS resolution failure
- Proxy not configured

**Fix:**
1. Test connectivity: `curl -I https://api.paubox.net`
2. Check firewall rules for api.paubox.net (port 443)
3. If behind proxy, set environment variables:
   ```bash
   export HTTP_PROXY=http://proxy:8080
   export HTTPS_PROXY=http://proxy:8080
   ```

### API Errors

**"Send failed (400)"**
**Causes:** Invalid email format, missing required fields, malformed payload

**Fix:** Check recipient addresses are valid. Ensure `--from` domain is authorized.

**"Send failed (403)"**
**Causes:** Sender domain not authorized for this API account

**Fix:** Verify the `--from` address domain is configured in Paubox dashboard.

**"Send failed (413)" or "Payload too large"**
**Causes:** Attachments exceed size limit

**Fix:** Reduce attachment size. Individual message limit is typically 25 MB.

**"Form not found (404)"**
**Fix:** Verify form ID is correct. Forms commands use a different endpoint than email.

### File Errors

**"Attachment not found"**
**Fix:** Check file path exists and is readable:
```bash
ls -la /path/to/attachment.pdf
```

**"Cannot read --data-file"**
**Fix:** Check JSON file path and format:
```bash
cat /path/to/data.json | jq .
```

---

## Platform-Specific Issues

### macOS

**Keychain access prompts**
If prompted to allow keychain access repeatedly:
1. Click "Always Allow" when prompted
2. Or use config file fallback by removing keytar:
   ```bash
   npm uninstall -g keytar
   ```

**Apple Silicon (M1/M2/M3) native module issues**
Ensure using native arm64 Node.js, not Rosetta:
```bash
node -p "process.arch"  # should show "arm64"
```

### Linux

**libsecret not available**
The CLI will fall back to config file storage. To enable keychain:
```bash
# Debian/Ubuntu
sudo apt-get install libsecret-1-dev gnome-keyring

# Fedora/RHEL
sudo dnf install libsecret-devel gnome-keyring

# Then reinstall
npm install -g paubox-cli
```

**D-Bus / Secret Service errors**
If running headless or via SSH:
```bash
# Start a D-Bus session
eval $(dbus-launch --sh-syntax)
```
Or accept config file fallback (automatic).

### Windows

**PowerShell execution policy**
```
paubox : File cannot be loaded because running scripts is disabled
```
**Fix:**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**Long path issues**
Enable long paths in Windows:
1. Run `gpedit.msc`
2. Navigate to: Computer Configuration → Administrative Templates → System → Filesystem
3. Enable "Enable Win32 long paths"

Or use npm with short path prefix:
```powershell
npm config set prefix "C:\npm"
```

---

## Known Limitations

1. **No interactive mode for email composition** — all options must be passed via flags
2. **No built-in retry logic** — network failures require manual retry
3. **Attachment size** — subject to API limits (typically 25 MB per message)
4. **Forms API** — separate from Email API; does not require authentication
5. **Keychain fallback** — when native keychain unavailable, credentials stored in plaintext config file with 0600 permissions

---

## Getting Help

- **GitHub Issues:** https://github.com/Paubox/paubox-cli/issues
- **Paubox Support:** support@paubox.com
- **API Documentation:** https://www.paubox.com/docs

When filing an issue, include:
1. CLI version (`paubox --version`)
2. Node.js version (`node --version`)
3. Operating system and version
4. Installation method (npm/brew/winget)
5. Verbose output of failing command (`paubox --verbose <command>`)
6. Any error messages with full text
