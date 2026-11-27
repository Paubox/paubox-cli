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

Each file exports a single `register*` function that receives the root `program` and attaches subcommands. Commands call `program.opts<OutputOptions>()` to read the global `--json` and `--quiet` flags defined at the root level. Exception to the one-file-per-command rule: the `forms` command tree is split across `forms.ts` (public `get`/`submit`; `registerFormsCommands`), `forms-admin.ts` (authenticated subcommands; `registerFormsAdminCommands(forms, program)`), and `forms-webhooks.ts` (the deprecated `forms webhooks` alias; `registerFormsWebhookCommands(forms, program)`) — both called from `registerFormsCommands`, and the user-visible tree is still `paubox forms <sub>`.

`paubox webhooks` (`webhooks.ts`) is the single webhook surface, backed by pb_webhooks (UUIDs, Bearer scoped key). It was two commands until 2.0.0: a `paubox webhooks` against the Email API's `/v1/email/webhook_endpoints`, and a `paubox forms webhooks` against pb_webhooks. The nesting existed because pb_webhooks mapped only the `forms` IAM scope for API keys. The 2026-10-14 Email API cutover changed that — `email_api` now maps to `view_email_api_section` — so one command covers every event a key is scoped for, and the legacy Email API client methods are gone. `forms-webhooks.ts` is a thin deprecated alias that delegates to `buildWebhookCommands` and warns; it exists so scripts written against 1.4.0 keep working.

### Library layer (`src/lib/`)

- **`api.ts`** — `PauboxApiClient` class. Uses `globalThis.fetch` by default; accepts an injected `fetch` function as a second constructor argument for testing. Two methods: `sendEmail` and `getMessageStatus`. Auth header format: `Token token=<apiKey>`. Also exports `resolveAttachments(filePaths)` — reads files, detects MIME type, returns base64-encoded `AttachmentOption[]`; shared by both email and forms commands.
- **`forms-api.ts`** — `FormsApiClient` class for the `https://apx.paubox.com/forms` endpoints. Constructor: `(fetchFn?, apiKey?, baseUrl?)` — all optional, back-compat with the old `(fetchFn?)` form. Base URL resolution order: explicit `baseUrl` argument, then the `PAUBOX_FORMS_URL` env var, then `DEFAULT_FORMS_BASE_URL`; `resolveFormsBaseUrl(env?)` is exported and throws `ConfigError` on a malformed or non-http(s) override. Two public (unauthenticated) methods: `getForm(formId)` (GET `/public/form_data/{id}`) and `submitForm(formId, payload)` (POST `/api/forms/{id}/submissions`, expects 201 with empty body). All other methods (`listForms`, `getFormStats`, `getFormAdmin`, `createForm`, `updateForm`, `archiveForm`, `unarchiveForm`, `copyForm`, `listSubmissions`, `exportSubmissionsCsv`, `exportSubmissionPdf`) hit authenticated endpoints with `Authorization: Bearer <formsApiKey>` (a scoped API key carrying the `forms` scope) and throw `AuthError` when no key was passed to the constructor. Shared `handleError` maps 401 → `AuthError`, 403/404/other → `ApiError`. CSV/PDF exports return `Buffer`.
- **`webhooks-api.ts`** — `WebhooksApiClient` for pb_webhooks' endpoint registry, reached through the public gateway at `https://api.paubox.com/v1/webhooks` (haproxy rewrites `/v1/webhooks/endpoints` onto the service's `/v1/endpoints`; only that resource is exposed publicly, so `/v1/events` ingest is unreachable). Constructor and base-URL resolution mirror `forms-api.ts`, with `PAUBOX_WEBHOOKS_URL` and `resolveWebhooksBaseUrl(env?)`. Methods: `listSubscriptions`, `getSubscription`, `createSubscription`, `updateSubscription`, `deleteSubscription`. Auth is `Authorization: Bearer <key>`, preferring the stored `formsApiKey` and falling back to `apiKey`: both reach this service now, and scope decides which events each may manage. IDs must be UUIDs; a non-UUID throws `ConfigError` before any request. Errors arrive as `{"message": "..."}` and are unwrapped by `errorMessage` (raw body as fallback): 401 → `AuthError`, 403/404/422/other → `ApiError`. `createSubscription` returns `signing_secret`, which the service never returns again, so callers must surface it. Also exports `WEBHOOK_EVENTS`, the catalogued events. That list is for help text and error hints only — `--events` is deliberately not validated against it, because the catalog lives in the service and can grow without a CLI release.
- **`credentials.ts`** — Tries `require('keytar')` inside a try/catch; falls back to `config-store.ts` when keytar is unavailable (no native build, missing libsecret, etc.). Stores both API keys as a single JSON string in one keychain entry. The browser login session (`saveSession`/`loadSession`/`clearSession`) lives in a second entry, account `session`, so saving or clearing the keys never touches it.
- **`browser-login.ts`** — `paubox auth login --web`. RFC 8252 loopback flow: listens on a random `127.0.0.1` port, opens `<webUrl>/cli/login?port&state&key` (paubox-next), and waits up to 5 minutes for one `GET /callback` carrying the right `state`. A wrong `state` gets a 400 and the wait continues; `error=access_denied` means the user clicked Cancel. On a result it 302s the browser to `<webUrl>/public/cli/done?status=…`, which also takes the payload out of the address bar. `openInBrowser` spawns `open`/`xdg-open`/`rundll32` without a shell, so the URL is never parsed as a command.
- **`login-crypto.ts`** — The session travels in that redirect URL, so it is encrypted to an ECDH P-256 key pair that only this process holds: HKDF-SHA256 (salt = state, info = `paubox-cli-login/v1`) into AES-256-GCM with the state as AAD. paubox-next's `src/utils/cliLoginCrypto.server.ts` is the other half; any change needs a v2 alongside v1, because released CLIs and the deployed dashboard must agree. `confirmationCode` derives the `XXXX-XXXX` code both sides display from the public key. Both repos pin the same key and code in tests.
- **`iam-api.ts`** — `IamClient`, called with the user session as `Authorization: Bearer`: `getEntitlements()` (`GET /v1/token_entitlements`, also how a session is checked) and `signOut()` (`DELETE /v2/users/sign_out`, denylists that one session). Service name `account`, so a 401 reads as "your login session has expired or was revoked".
- **`environments.ts`** — `resolveEnvironment` picks the dashboard and IAM URLs for browser login: `--env`/`PAUBOX_ENV` (`production`, `staging`), overridden per URL by `--web-url`/`PAUBOX_WEB_URL` and `--iam-url`/`PAUBOX_IAM_URL`. Any override makes the environment `custom`.
- **`config-store.ts`** — Reads/writes `~/.config/paubox/config.json` (Linux/macOS) or `%APPDATA%\paubox\config.json` (Windows). Stores credentials under a `credentials` key and user preferences under a `config` key in the same file. Exports `setConfigDir(dir)` — used in tests to redirect I/O to a temp directory.
- **`output.ts`** — All terminal output goes through here; commands never call `console.log` directly. `printError` and `printErrorJson` write to stderr; everything else to stdout. Errors go to stderr even under `--json` so a script reading stdout for results keeps parsing.
- **`errors.ts`** — `PauboxError` plus `AuthError`, `ApiError`, `ConfigError`, `ValidationError`, `NetworkError`. Each carries a `kind`, an `exitCode` from the `ExitCode` map (auth 2, validation 3, api 4, network 5, config 6), an optional `suggestion`, an optional `requestId`, and a `toJson()` for `--json`. The exit codes are part of the CLI's public contract — changing one is a breaking change. `AuthError` has three factories (`missing`, `invalid`, `forbidden`) because the remedy, not the type, is what differs: the Email API key and the scoped Forms key are not interchangeable, and sending the wrong one is otherwise indistinguishable from sending a bad one.
- **`http.ts`** — `HttpClient`, the single path every outbound request takes. Injects the client-identification headers, applies a timeout (`--timeout`, then `PAUBOX_TIMEOUT`, used exactly; otherwise 30s plus the body's upload time at 256 KB/s, so large sends are never cut off mid-upload; see `timeoutForRequest`). A timed-out non-idempotent request warns it may already have been accepted, so the user checks before retrying, retries idempotent requests on 429/502/503/504 and transient transport failures, and hands non-2xx responses to `api-errors.ts`. Returns only on success, so callers never write `if (!response.ok)`. `describeNetworkError` translates undici's uniform `TypeError: fetch failed` into a named cause by walking `err.cause` — without it a DNS failure and a TLS failure read identically.
- **`api-errors.ts`** — `throwForResponse(response, ctx)`, the one place a status code becomes an error. `extractMessage` is deliberately shape-agnostic rather than one parser per service: the three backends use three different envelopes between them (`{errors:[{code,title,details}]}` from the Email API's `ErrorBuilder`, `{code,title,details}` from its schema validator, and `{message}` from both pb_webhooks and pb_rforms, the Rust/Axum Forms service, whose `ApiError` always emits that shape), and a service changing shape should degrade to the raw body rather than to `undefined`. The `{detail}`, `{error}` and field-map (`{errors:{field:[...]}}`) branches are defensive fallbacks, not shapes any current backend sends. An HTML body on a 5xx is recognised as haproxy's stock error page and reported as a gateway outage instead of being printed at the user.
- **`validate.ts`** — Local checks that run before any request: address shape, at least one body, attachment size against the 250 MB request cap, schedule time in the future. Collects every problem in one pass rather than failing at the first, so fixing a malformed command is one round rather than one round per field.

### Client identification

Every request carries `User-Agent: paubox-cli/<version> (node/<ver>; <platform> <arch>)`, `X-Paubox-Client: paubox-cli`, `X-Paubox-Client-Version`, `X-Paubox-Client-Command` (the command path, e.g. `forms submit`) and `X-Request-Id: pbcli-<uuid>`.

These exist so Paubox-side logs can attribute an error to the CLI without the CLI phoning home — it is a user-run binary, not a hosted service, so telemetry is the wrong mechanism. The `pbcli-` prefix on the request id is load-bearing: it makes a log line attributable even where the proxy captures no client header. The command *name* only is sent, never arguments, addresses or message content, because these headers land in access logs that are not a PHI boundary.

`transactional_email` adopts an inbound `X-Request-Id` via ActionDispatch and echoes it back, so the id printed on failure is the same id in the server-side logs.

### Testing patterns

- **HTTP mocking**: inject a `jest.fn()` as the second arg to `PauboxApiClient`, or as `fetchFn` in `HttpClientConfig`. Do not use nock (undici compatibility issue with Node 22's built-in fetch). `test/helpers/fake-response.ts` has `fakeResponse(status, body, headers)` and `transportFailure(code)`, which shapes a thrown error the way undici nests the real cause.
- **keytar mocking**: use `jest.isolateModulesAsync` so each test gets fresh module instances. The helper pattern in `credentials.test.ts` (`withCreds`) is the established pattern.
- **Config store in tests**: call `configStore.setConfigDir(tmpDir)` in `beforeEach`, reset to `''` in `afterEach`.
- **Command tests**: call `createProgram().parseAsync(['node', 'paubox', ...])` directly. Mock `../../src/lib/credentials` and `../../src/lib/api` at the module level. For the public `forms get`/`forms submit` commands, mock `../../src/lib/forms-api` entirely (no credentials needed) and mock `resolveAttachments` from `../../src/lib/api`. For the authenticated forms subcommands (`test/commands/forms-admin.test.ts`), mock both `../../src/lib/forms-api` and `../../src/lib/credentials`. `test/commands/webhooks.test.ts` mocks `../../src/lib/webhooks-api` with a `jest.requireActual` spread rather than the plain automock, so the real module constants survive while `WebhooksApiClient` is replaced. It covers the canonical `paubox webhooks` surface, the deprecated `paubox forms webhooks` alias (including that the notice goes to stderr, not stdout), and the Forms-then-Email credential fallback.

### Browser login session

`paubox auth login --web` stores a `UserSession` (`src/types.ts`): an IAM session token minted for the CLI by paubox-next's `/api/cli/authorize` (via IAM `refresh_session`, so it has its own jti and carries the MFA verification across), plus the environment's URLs, the user, and the token's expiry. It acts as the person, so it is never sent to the key-authenticated APIs. `auth status` checks it live against IAM and reports `active`, `expired`, `revoked` or `unverified` (IAM unreachable). `auth logout` revokes it at IAM before clearing both stores. `auth token` prints it for other local tools, chiefly the Paubox MCP stdio server, which runs `paubox --json auth token` instead of reading the keychain itself.

With no flags and a TTY, `auth login` asks whether to use the browser or paste an API key. Without a TTY it keeps the old API-key prompt, so nothing scripted changes.

### Credential storage

Credentials are stored as `JSON.stringify({ apiKey, formsApiKey? })` in a single keychain entry (`service: 'paubox-cli'`, `account: 'default'`). `formsApiKey` is optional (set via `paubox auth set-forms-key`) — a stored blob without it must keep loading (back-compat), and extra legacy fields in older blobs (from the days when a username was stored) are simply ignored. `auth set-forms-key` works standalone: with no prior `auth login`, `apiKey` is saved as an empty string, and `auth status` treats an empty `apiKey` as not-authenticated for the email API while still reporting the forms key. The file fallback stores the same full credentials object in the `credentials` section of `~/.config/paubox/config.json` (Linux/macOS) or `%APPDATA%\paubox\config.json` (Windows) with `0600` permissions (mode is a no-op on Windows).

### Distribution

- **npm**: `files` in `package.json` whitelists `bin/`, `dist/`, `LICENSE`, `README.md`. Run `npm run prepublishOnly` before publishing (runs typecheck + lint + test + build).
- **Homebrew**: separate repo `paubox/homebrew-paubox`. Formula pulls the npm tarball; SHA256 must be updated on each release.
