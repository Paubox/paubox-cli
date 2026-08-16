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

### Windows

```powershell
winget install Paubox.CLI
```

Or via npm:

```powershell
npm install -g paubox-cli
```

> **Keytar (optional):** The CLI uses the Windows Credential Vault for secure credential storage via the `keytar` native module. If `keytar` fails to build during install, credentials fall back to a config file automatically — no action required. To enable native keychain support, install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) before running `npm install -g paubox-cli`.

### Requirements

- Node.js ≥ 20.12.0
- On Linux: `libsecret-1-dev` is required for OS keychain support
  ```bash
  sudo apt-get install libsecret-1-dev
  ```
  Without it, credentials fall back to a local config file automatically (`~/.config/paubox/config.json` on Linux/macOS, `%APPDATA%\paubox\config.json` on Windows).

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
paubox auth login          # Prompt for API key; validate and store
paubox auth set-forms-key  # Prompt for a Forms API key (scoped key with the "forms" scope)
paubox auth logout         # Remove stored credentials (including the Forms API key)
paubox auth status         # Show current authentication state
```

Credentials are stored in the OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service) when available. If the keychain is unavailable, they fall back to a local config file (`~/.config/paubox/config.json` on Linux/macOS, `%APPDATA%\paubox\config.json` on Windows).

#### Forms API key

The authenticated `paubox forms` subcommands (`list`, `stats`, `submissions`, `export-csv`, `export-pdf`, `archive`, `unarchive`, `copy`, `create`, `update`) require a **scoped API key with the `forms` scope**. Store it with:

```bash
paubox auth set-forms-key
```

This works standalone — you do not need to run `paubox auth login` first. `paubox auth status` shows the (masked) Forms API key alongside your email API credentials. The key is not validated at save time; an invalid key or one missing the `forms` scope surfaces as a 401 error on first use.

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

### `paubox forms`

Work with Paubox forms. Two commands are public and require no authentication (`forms get`, `forms submit`). All other subcommands are authenticated and require a Forms API key — a scoped API key with the `forms` scope, stored via [`paubox auth set-forms-key`](#forms-api-key).

#### `forms get <formId>`

```bash
paubox forms get <formId>
paubox --json forms get <formId>
```

Prints the form's title, description, active status, submission count, and timestamps. With `--json`, returns the raw API response object.

#### `forms submit <formId>`

```bash
# Inline key=value pairs (repeatable)
paubox forms submit <formId> \
  --data "first_name=Jane" \
  --data "last_name=Doe" \
  --data "email=jane@example.com"

# Read form fields from a JSON file
paubox forms submit <formId> --data-file ./fields.json

# Mix file and inline overrides (--data wins on matching keys)
paubox forms submit <formId> \
  --data-file ./base.json \
  --data "field=override"

# Attach a file with the submission
paubox forms submit <formId> \
  --data "name=Jane" \
  --attach /path/to/signed-consent.pdf
```

| Flag | Description |
|------|-------------|
| `--data <key=value>` | Form field as a key=value pair. Repeatable. Values may contain `=`. |
| `--data-file <path>` | Path to a JSON file whose top-level string values are used as form_data. Merged with `--data`; `--data` takes precedence on matching keys. |
| `--attach <file>` | File to include as an attachment. Repeatable. Total request size must not exceed 250 MB. |

On success:
```
✓ Form submitted successfully.
```

With `--json`:
```json
{ "status": "ok", "formId": "<formId>" }
```

#### Authenticated subcommands

The following subcommands require a Forms API key (see [Forms API key](#forms-api-key)). All of them respect the global `--json` flag; with `--json`, list/stats/copy commands print the raw API response.

##### `forms list`

List forms for a customer.

```bash
paubox forms list --customer-id 42 --search intake --active true --order-by updated_at --order desc
```

| Flag | Required | Description |
|------|----------|-------------|
| `--customer-id <id>` | Yes | Customer ID to list forms for (integer) |
| `--page <n>` | No | Page number (default 1) |
| `--items <n>` | No | Items per page (default 50, max 100) |
| `--search <text>` | No | Search text (matches title/description) |
| `--form-id <id>` | No | Filter to a single form ID |
| `--active <true\|false>` | No | Filter by active state |
| `--archived <true\|false>` | No | Filter by archived state |
| `--order-by <col>` | No | Sort column: `title`, `updated_at`, `submission_count`, `created_at` |
| `--order <asc\|desc>` | No | Sort direction |

Human output is one line per form (`<id>  <title>  active=<bool> archived=<bool> submissions=<n>`) followed by `Page X of Y (N forms total)`.

##### `forms stats`

Show form statistics: active form count, total submissions, and submissions in the last 7 days.

```bash
paubox forms stats                     # defaults to the API key's customer
paubox forms stats --customer-id 42
```

##### `forms submissions <formId>`

List submissions for a form.

```bash
paubox forms submissions <formId> --page 1 --items 25 --order-by created_at --order desc
```

| Flag | Description |
|------|-------------|
| `--page <n>` | Page number (default 1) |
| `--items <n>` | Items per page (default 50, max 100) |
| `--order-by <col>` | Sort column: `created_at`, `submitter_email` |
| `--order <asc\|desc>` | Sort direction |
| `--submission-id <id>` | Filter to a single submission ID |

Human output is one line per submission (`<id>  <created_at>  <submitter_email>`) plus a totals line.

##### `forms export-csv <formId> [submissionId]`

Export a form's submissions (or a single submission) as CSV.

```bash
paubox forms export-csv <formId>                          # → form-<formId>-submissions.csv
paubox forms export-csv <formId> <submissionId>           # → submission-<submissionId>.csv
paubox forms export-csv <formId> --output ./export.csv    # custom path
```

##### `forms export-pdf <formId> <submissionId>`

Export a single submission as PDF.

```bash
paubox forms export-pdf <formId> <submissionId> --output ./submission.pdf
```

Defaults to `submission-<submissionId>.pdf` when `--output` is omitted.

##### `forms archive <formId>` / `forms unarchive <formId>`

Archive or unarchive a form.

```bash
paubox forms archive <formId>
paubox forms unarchive <formId>
```

##### `forms copy <formId>`

Copy an existing form under a new title. Prints the new form's ID and title.

```bash
paubox forms copy <formId> --title "Copy of intake form"
```

`--title` is required.

##### `forms create`

Create a new form from a JSON definition file. Prints the created form's ID.

```bash
paubox forms create \
  --title "Patient intake" \
  --customer-id 42 \
  --form-json-file ./form.json \
  --description "New patient intake form" \
  --recipient forms@yourdomain.com \
  --active
```

| Flag | Required | Description |
|------|----------|-------------|
| `--title <t>` | Yes | Form title |
| `--customer-id <id>` | Yes | Customer ID that owns the form (integer) |
| `--form-json-file <path>` | Yes | Path to a JSON file with the form definition |
| `--description <text>` | No | Form description |
| `--recipient <email>` | No | Recipient email address |
| `--active` | No | Mark the form active (default: inactive) |
| `--signable` | No | Mark the form signable |
| `--signature-confirmation-label <label>` | No | Signature confirmation label |
| `--subscription-list-id <id>` | No | Subscription list ID |
| `--type <type>` | No | Form type |
| `--version <n>` | No | Form version (default 1) |
| `--form-html-file <path>` | No | Path to a file with the form HTML |
| `--form-css-file <path>` | No | Path to a file with the form CSS |

##### `forms update <formId>`

Update a form. Only the fields you pass are sent (PATCH-style); at least one option is required.

```bash
paubox forms update <formId> --title "Renamed form" --active false
```

| Flag | Description |
|------|-------------|
| `--title <t>` | New title |
| `--description <text>` | New description |
| `--recipient <email>` | New recipient email address |
| `--active <true\|false>` | Set active state |
| `--vanity-url <url>` | New vanity URL |
| `--subscription-list-id <id>` | New subscription list ID |
| `--form-json-file <path>` | Path to a JSON file with the new form definition |

---

### `paubox marketing`

Access to Paubox Marketing — subscribers, lists, campaign mailings, analytics
reports, and bulk job status.

These commands use the API key stored by `paubox auth login`. No separate key is
needed: they talk to the username-less marketing gateway at
`https://api.paubox.com/v1/marketing`, which resolves your account from that key.

Your account must have Paubox Marketing enabled. If it doesn't, the CLI reports
`No Paubox Marketing account is associated with this API key.`

#### `marketing subscribers list`

```bash
paubox marketing subscribers list
paubox marketing subscribers list --search jane --items 25
paubox marketing subscribers list --subscription-list-id <id> --order-by created_at --order desc
paubox --json marketing subscribers list
```

| Flag | Description |
|------|-------------|
| `--search <text>` | Search text (defaults to all subscribers) |
| `--subscription-list-id <id>` | Filter to a subscription list |
| `--dynamic-list-id <id>` | Filter to a dynamic list |
| `--page <n>` | Page number (default 1) |
| `--items <n>` | Items per page (default 50, max 10000) |
| `--order-by <col>` | `created_at`, `updated_at`, `email`, `first_name`, `last_name` |
| `--order <asc\|desc>` | Sort direction |

#### `marketing subscribers get <subscriberId>`

```bash
paubox marketing subscribers get <subscriberId>
paubox marketing subscribers get <subscriberId> --subscription-list-id <id> --with-stats
```

| Flag | Description |
|------|-------------|
| `--subscription-list-id <id>` | Report unsubscribed state for this subscription list |
| `--dynamic-list-id <id>` | Report unsubscribed state for this dynamic list |
| `--with-stats` | Include delivery statistics |

#### `marketing subscribers count`

Subscribed count for a list. Defaults to the account's default list.

```bash
paubox marketing subscribers count
paubox marketing subscribers count --subscription-list-id <id>
```

#### `marketing subscribers create` / `marketing subscribers update <subscriberId>`

```bash
paubox marketing subscribers create --email jane@example.com --first-name Jane --last-name Doe
paubox marketing subscribers create --email jane@example.com --field "Clinic=North Campus" --field "Plan=Gold"
paubox marketing subscribers update <subscriberId> --phone +15555550123
```

| Flag | Description |
|------|-------------|
| `--email <email>` | Email address |
| `--first-name <name>` | First name |
| `--last-name <name>` | Last name |
| `--phone <number>` | Phone number (normalized to E.164 by the API) |
| `--field <name=value>` | Custom field (repeatable) |
| `--subscription-list-id <id>` | Also add to this subscription list |

New subscribers are always added to the account's default list;
`--subscription-list-id` adds them to one more list on top of that.

A `--field` name that doesn't exist yet is **created** as a new custom field
type on the account — a typo makes a new field rather than an error, so check
names against `paubox marketing subscribers get`.

#### `marketing subscribers export-csv` / `marketing subscribers export-dynamic-csv`

Exports run as background jobs and are emailed to the address you give. Both
print a job ID you can poll with `marketing jobs get`.

```bash
paubox marketing subscribers export-csv --email me@example.com
paubox marketing subscribers export-csv --email me@example.com --from-subscription-list-id <id> --search jane
paubox marketing subscribers export-dynamic-csv --email me@example.com --dynamic-list-id <id>
```

| Flag | Description |
|------|-------------|
| `--email <email>` | **Required.** Address the export is emailed to |
| `--from-subscription-list-id <id>` | (`export-csv`) Export from this subscription list |
| `--search <text>` | (`export-csv`) Restrict the export to matching subscribers |
| `--subscriber-id <id...>` | (`export-csv`) Export only these subscriber UUIDs |
| `--except-id <id...>` | (`export-csv`) Exclude these subscriber UUIDs |
| `--dynamic-list-id <id>` | (`export-dynamic-csv`) **Required.** Dynamic list to export |
| `--order-by <col>` / `--order <asc\|desc>` | (`export-dynamic-csv`) Sorting |

#### `marketing subscriptions subscribe` / `marketing subscriptions unsubscribe`

```bash
paubox marketing subscriptions subscribe --subscriber-id <uuid> --subscription-list-id <id>
paubox marketing subscriptions unsubscribe --subscriber-id <uuid> --subscription-list-id <id>

# Global opt-out across every list — prompts for confirmation
paubox marketing subscriptions unsubscribe --subscriber-id <uuid>
```

| Flag | Description |
|------|-------------|
| `--subscriber-id <id...>` | **Required.** Subscriber UUIDs |
| `--subscription-list-id <id...>` | Limit the change to these lists |
| `-y, --yes` | (`unsubscribe`) Skip the global-unsubscribe confirmation |

**`unsubscribe` without `--subscription-list-id` is a global opt-out** — it
suppresses the subscriber across every list, not just one. The CLI prompts
before doing this. In a non-interactive shell it refuses unless you pass
`--yes`, rather than hanging on a prompt nobody will answer.

`subscribe` always clears any global opt-out, because a subscriber on any list
is by definition not globally unsubscribed.

#### `marketing subscription-lists` / `marketing dynamic-lists`

Full CRUD for each list type. `marketing lists list` (below) is the combined
read-only view across both.

```bash
paubox marketing subscription-lists list
paubox marketing subscription-lists get default          # the account's default list
paubox marketing subscription-lists get <id> --with-stats
paubox marketing subscription-lists create --name "VIP customers"
paubox marketing subscription-lists update <id> --name "VIPs"
paubox marketing subscription-lists delete <id>          # prompts for confirmation

paubox marketing dynamic-lists list
paubox marketing dynamic-lists get <id>
paubox marketing dynamic-lists create --name "Recent signups" --filters '[[{"field":"email","op":"contains","terms":["@example.com"]}]]'
paubox marketing dynamic-lists create --name "Recent signups" --filters-file ./filters.json
paubox marketing dynamic-lists update <id> --name "Renamed"
paubox marketing dynamic-lists delete <id>               # prompts for confirmation
```

| Flag | Description |
|------|-------------|
| `--name <name>` | List name (required on `create`) |
| `--filters <json>` | (dynamic lists) Filter definition as JSON |
| `--filters-file <path>` | (dynamic lists) Read the filter definition from a JSON file |
| `--with-stats` | (`get`) Include send statistics |
| `--page <n>` / `--items <n>` | (`list`) Pagination — off unless one is given |
| `--order-by <col>` / `--order <asc\|desc>` | (`list`) Sorting |
| `-y, --yes` | (`delete`) Skip the confirmation prompt |

Deleting a subscription list removes its subscriptions and marks its drip
campaigns completed. **The default list cannot be deleted** — the API accepts
the request and silently does nothing.

`--filters` and `--filters-file` are mutually exclusive, and the CLI validates
that the value parses as JSON before sending it.

#### `marketing lists list`

Lists both subscription lists and dynamic lists.

```bash
paubox marketing lists list
paubox marketing lists list --search contacts --page 1 --items 25
```

| Flag | Description |
|------|-------------|
| `--search <text>` | Search list names |
| `--page <n>` | Page number (enables pagination) |
| `--items <n>` | Items per page (enables pagination, default 10) |
| `--order-by <col>` | `name`, `created_at`, `updated_at`, `subscriber_count` |
| `--order <asc\|desc>` | Sort direction |

Pagination is off by default on this endpoint, so all lists are returned unless
you pass `--page` or `--items`.

#### `marketing campaigns list` / `marketing campaigns get <campaignId>`

```bash
paubox marketing campaigns list
paubox marketing campaigns list --search newsletter --template-type standard
paubox marketing campaigns get <campaignId>
paubox marketing campaigns get <campaignId> --with-images
```

| Flag | Description |
|------|-------------|
| `--search <text>` | Search campaign subjects |
| `--page <n>` | Page number (default 1) |
| `--template-type <type>` | Filter by template type |
| `--order-by <col>` | `created_at`, `updated_at`, `subject` |
| `--order <asc\|desc>` | Sort direction |
| `--with-images` | (`get` only) Include image data |

`SENT` shows `N/A` when the backend cannot reconcile the sent count against the
delivered count.

#### `marketing analytics <type>`

Fetches one analytics report. Output is always JSON, because each report has its
own shape.

```bash
paubox marketing analytics campaign_mailing_send_totals
paubox marketing analytics campaign_mailing_sends_table --start-date 2026-01-01 --end-date 2026-02-01
paubox marketing analytics tracking_links_by_unique_link --campaign-mailing-send-id <id>
```

| Report type | Description |
|-------------|-------------|
| `campaign_mailing_send_totals` | Aggregate send totals |
| `campaign_mailing_sends_table` | Per-send rows |
| `campaign_mailing_deliveries_table` | Per-delivery rows for a send or mailing |
| `subscribers_by_tracking_link` | Subscribers who clicked a given tracking link |
| `tracking_links_by_unique_link` | Click counts grouped by link |

| Flag | Description |
|------|-------------|
| `--campaign-mailing-send-id <id>` | Campaign mailing send ID |
| `--campaign-mailing-id <id>` | Campaign mailing ID |
| `--drip-campaign-id <id>` | Drip campaign ID |
| `--email-type <type>` | Filter by email type |
| `--html-id <id>` | Tracking link HTML ID |
| `--search <text>` | Search text |
| `--start-date <date>` / `--end-date <date>` | ISO 8601 date range |
| `--by-date` | Group totals by date |
| `--date-offset <n>` | Day offset used when `--by-date` has no explicit range |
| `--with-stats` | Include per-row statistics |
| `--order-by <col>` / `--order <asc\|desc>` | Sorting |

Not every flag applies to every report; unrelated flags are ignored by the API.

#### `marketing jobs list` / `marketing jobs get <bid>`

Bulk operations in Paubox Marketing run asynchronously and return a batch ID.
These commands report their progress.

```bash
paubox marketing jobs list          # in-flight and recently completed jobs
paubox marketing jobs get <bid>     # status of a single batch
```

---

### `paubox config`

Manage CLI configuration stored in `~/.config/paubox/config.json` (Linux/macOS) or `%APPDATA%\paubox\config.json` (Windows).

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAUBOX_FORMS_URL` | Override the Forms API base URL. Defaults to `https://apx.paubox.com/forms`. Must be an `http` or `https` URL. |
| `PAUBOX_MARKETING_URL` | Override the Marketing API base URL. Defaults to `https://api.paubox.com/v1/marketing`. Must be an `http` or `https` URL. |

These point the `paubox forms` and `paubox marketing` commands at a non-production
environment without patching and rebuilding:

```bash
PAUBOX_FORMS_URL=https://api.staging.paubox.net/forms paubox forms list
PAUBOX_MARKETING_URL=https://api.staging.paubox.net/v1/marketing paubox marketing lists list
```

Your API key is sent to whatever host these resolve to, so only point them at
Paubox-operated environments.

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
  homepage "https://github.com/Paubox/paubox-cli"
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
git clone https://github.com/Paubox/paubox-cli.git
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
  commands/       auth, send, status, config, forms, forms-admin, marketing command handlers
  lib/            api client, forms API client, marketing API client, credential storage, config store, output helpers
  index.ts        Library entry — exports createProgram() and run()
  cli.ts          Runtime entry — invokes run() (used by bin/ and `npm run dev`)
bin/
  paubox.js       Shebang wrapper (ships in npm package)
test/             Jest unit tests mirroring src/ structure
```

## Releasing

Releases are fully automated through [Release Please](https://github.com/googleapis/release-please) and [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers). No local commands, no tokens, no manual tagging.

### Flow

1. Land changes on `master` using [Conventional Commits](https://www.conventionalcommits.org/):
   - `fix: ...` → patch bump (e.g. 0.1.0 → 0.1.1)
   - `feat: ...` → minor bump (e.g. 0.1.0 → 0.2.0)
   - `feat!: ...` or `BREAKING CHANGE:` in the body → minor bump pre-1.0, major bump after 1.0
   - `chore: ...`, `docs: ...`, `refactor: ...`, `test: ...` → no version bump
2. The **release-please** workflow opens (or updates) a PR titled `chore(master): release <next-version>` with a generated `CHANGELOG.md` entry and the version bump in `package.json` and `.release-please-manifest.json`.
3. When that PR is merged, the same workflow creates the `paubox-cli-v<version>` git tag + GitHub Release, then immediately runs a dependent `publish` job that validates the build and publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements) via OIDC.

Release-please and the publish job live in the same workflow file (`release-please.yml`) on purpose: a separate workflow listening for tag pushes would never fire, because tags created by `GITHUB_TOKEN` deliberately don't trigger downstream workflows. Chaining the jobs via `needs:` keeps the entire release in one run, no PAT required.

If the publish job ever fails for a transient reason (registry hiccup, OIDC rotation, etc.), recover by re-running just the failed job from the Actions UI — the `release-please` job already created the tag and Release, so re-running the `publish` job picks them up unchanged.

### Setup requirements (one-time)

- Repository setting: **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** (so release-please can open the release PR).
- npm package setting: a trusted publisher must be configured at `npmjs.com/package/paubox-cli/access`, pointing at this repo and `release-please.yml`.

## License

Apache 2.0 — see [LICENSE](LICENSE)
## 💬 Community & support

Questions, ideas, or want to share what you built? Join the **[Paubox Community](https://github.com/Paubox/community/discussions)** — the single home for discussions across every Paubox SDK and API.

🔐 Found a security issue? Email **devops@paubox.com** — please don't post it publicly.
