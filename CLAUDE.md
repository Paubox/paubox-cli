# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck          # TypeScript type check (no emit)
npm run lint               # ESLint
npm run lint:fix           # ESLint with auto-fix
npm test                   # Jest (all tests)
npm run test:coverage      # Jest with coverage report (threshold: 70% branches, 80% lines/funcs)
npm run build              # Compile TypeScript → dist/
npm run dev -- <args>      # Run CLI from source without building (e.g. npm run dev -- auth status)
```

**Run a single test file:**
```bash
npx jest test/lib/api.test.ts
npx jest test/commands/send.test.ts
```

**Run tests matching a name pattern:**
```bash
npx jest --testNamePattern "sends email"
```

## Architecture

### Entry point flow

`bin/paubox.js` → calls `run()` from `dist/index.js` → `run()` calls `createProgram().parseAsync()`.

`src/index.ts` exports two things: `createProgram()` (factory that wires all commands onto a Commander instance) and `run()` (calls `parseAsync` and handles top-level errors). The factory pattern is intentional — tests call `createProgram()` directly to avoid module-level side effects.

### Command layer (`src/commands/`)

Each file exports a single `register*` function that receives the root `program` and attaches subcommands. Commands call `program.opts<OutputOptions>()` to read the global `--json` and `--quiet` flags defined at the root level. Exception to the one-file-per-command rule: the `forms` command tree is split across `forms.ts` (public `get`/`submit`; `registerFormsCommands`) and `forms-admin.ts` (authenticated subcommands; `registerFormsAdminCommands(forms, program)`, called from `registerFormsCommands`) — the user-visible tree is still `paubox forms <sub>`.

### Library layer (`src/lib/`)

- **`api.ts`** — `PauboxApiClient` class. Uses `globalThis.fetch` by default; accepts an injected `fetch` function as a second constructor argument for testing. Two methods: `sendEmail` and `getMessageStatus`. Auth header format: `Token token=<apiKey>`. Also exports `resolveAttachments(filePaths)` — reads files, detects MIME type, returns base64-encoded `AttachmentOption[]`; shared by both email and forms commands.
- **`forms-api.ts`** — `FormsApiClient` class for the `https://apx.paubox.com/forms` endpoints. Constructor: `(fetchFn?, apiKey?)` — both optional, back-compat with the old `(fetchFn?)` form. Two public (unauthenticated) methods: `getForm(formId)` (GET `/public/form_data/{id}`) and `submitForm(formId, payload)` (POST `/api/forms/{id}/submissions`, expects 201 with empty body). All other methods (`listForms`, `getFormStats`, `getFormAdmin`, `createForm`, `updateForm`, `archiveForm`, `unarchiveForm`, `copyForm`, `listSubmissions`, `exportSubmissionsCsv`, `exportSubmissionPdf`) hit authenticated endpoints with `Authorization: Bearer <formsApiKey>` (a scoped API key carrying the `forms` scope) and throw `AuthError` when no key was passed to the constructor. Shared `handleError` maps 401 → `AuthError`, 403/404/other → `ApiError`. CSV/PDF exports return `Buffer`.
- **`credentials.ts`** — Tries `require('keytar')` inside a try/catch; falls back to `config-store.ts` when keytar is unavailable (no native build, missing libsecret, etc.). Stores both credentials as a single JSON string in one keychain entry.
- **`config-store.ts`** — Reads/writes `~/.config/paubox/config.json` (Linux/macOS) or `%APPDATA%\paubox\config.json` (Windows). Stores credentials under a `credentials` key and user preferences under a `config` key in the same file. Exports `setConfigDir(dir)` — used in tests to redirect I/O to a temp directory.
- **`output.ts`** — All terminal output goes through here; commands never call `console.log` directly. `printError` writes to stderr; everything else to stdout.
- **`errors.ts`** — `PauboxError`, `AuthError`, `ApiError`, `ConfigError`. All carry `exitCode` and optional `suggestion`. Top-level `run()` in `index.ts` catches these and prints the suggestion before exiting.

### Testing patterns

- **HTTP mocking**: inject a `jest.fn()` as the second arg to `PauboxApiClient`. Do not use nock (undici compatibility issue with Node 22's built-in fetch).
- **keytar mocking**: use `jest.isolateModulesAsync` so each test gets fresh module instances. The helper pattern in `credentials.test.ts` (`withCreds`) is the established pattern.
- **Config store in tests**: call `configStore.setConfigDir(tmpDir)` in `beforeEach`, reset to `''` in `afterEach`.
- **Command tests**: call `createProgram().parseAsync(['node', 'paubox', ...])` directly. Mock `../../src/lib/credentials` and `../../src/lib/api` at the module level. For the public `forms get`/`forms submit` commands, mock `../../src/lib/forms-api` entirely (no credentials needed) and mock `resolveAttachments` from `../../src/lib/api`. For the authenticated forms subcommands (`test/commands/forms-admin.test.ts`), mock both `../../src/lib/forms-api` and `../../src/lib/credentials`.

### Credential storage

Credentials are stored as `JSON.stringify({ apiUsername, apiKey, formsApiKey?, marketingApiKey? })` in a single keychain entry (`service: 'paubox-cli'`, `account: 'default'`). `formsApiKey` and `marketingApiKey` are optional (set via `paubox auth set-forms-key` / `paubox auth set-marketing-key`) — a stored blob without them must keep loading (back-compat). `auth set-forms-key` and `auth set-marketing-key` work standalone: with no prior `auth login`, `apiUsername`/`apiKey` are saved as empty strings, and `auth status` treats empty strings as not-authenticated for the email API while still reporting the forms/marketing keys. The file fallback stores the same full credentials object in the `credentials` section of `~/.config/paubox/config.json` (Linux/macOS) or `%APPDATA%\paubox\config.json` (Windows) with `0600` permissions (mode is a no-op on Windows).

### Distribution

- **npm**: `files` in `package.json` whitelists `bin/`, `dist/`, `LICENSE`, `README.md`. Run `npm run prepublishOnly` before publishing (runs typecheck + lint + test + build).
- **Homebrew**: separate repo `paubox/homebrew-paubox`. Formula pulls the npm tarball; SHA256 must be updated on each release.
