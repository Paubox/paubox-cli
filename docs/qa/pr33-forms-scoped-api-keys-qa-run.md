# QA Run — paubox-cli PR #33 (scoped API keys + authenticated Forms commands)

**PR:** [feat: add authenticated Paubox Forms commands via scoped API keys](https://github.com/Paubox/paubox-cli/pull/33)
**Branch:** `feat-scoped-api-keys` → `master`
**Scope of change:** 14 files, +2686 / −27 — new `src/commands/forms-admin.ts`, extended `src/lib/forms-api.ts` (11 authenticated methods), credential storage gains `formsApiKey`, new `auth set-forms-key`, 10 new `paubox forms` subcommands, tests + docs
**Depends on:** pb_rforms PR #56 (scoped-API-key auth for the Forms API) — merged 2026-08-11 and **must be deployed** to the environment under test

---

## 1. What this adds (one-paragraph context for the tester)

pb_rforms now accepts a **scoped API key** on its protected endpoints: `Authorization: Bearer <key>` where the key (no `.` in it, unlike a JWT) is validated against IAM's `/v1/api_key_entitlements` and must carry the **`forms` scope**. That makes the authenticated Forms API usable from a CLI for the first time. This PR adds the key to the CLI's credential store (single JSON blob: OS keychain via keytar, or `~/.config/paubox/config.json` fallback at mode 0600), a `paubox auth set-forms-key` command to save it, and ten new authenticated subcommands under `paubox forms`: `list`, `stats`, `submissions`, `export-csv`, `export-pdf`, `archive`, `unarchive`, `copy`, `create`, `update`. The two public commands (`forms get`, `forms submit`) are intentionally unchanged. All errors exit with code **1** and print a `suggestion` line on stderr.

> **Base URL:** defaults to `https://apx.paubox.com/forms` (production). To run this sheet against **staging**, set `PAUBOX_FORMS_URL=https://api.staging.paubox.net/forms` — no patching or rebuilding required, so the artifact under test is the one that ships. Running against production with a dedicated **test customer** remains supported and is the prod-primary default.

---

## 2. Pass / fail criteria (TL;DR)

| # | Criterion | Pass condition |
|---|-----------|----------------|
| C1 | Automated suite green | `npm run typecheck && npm run lint && npm test` all pass (228 tests); coverage ≥ 70% branches / 80% lines+funcs via `npm run test:coverage` |
| C2 | Key lifecycle correct | `set-forms-key` saves (standalone **and** alongside email creds); `auth login` **preserves** an existing forms key; `logout` clears everything; old credential blobs without `formsApiKey` still load |
| C3 | All 10 subcommands work E2E | Each command in §6 returns expected data / writes a valid file against a real deployment |
| C4 | Auth failures map correctly | No key → actionable `AuthError` without any HTTP call; invalid key / missing `forms` scope → 401-mapped `AuthError`; foreign `customer_id` → 403-mapped `ApiError`; bad IDs → 404 message |
| C5 | No regression in existing commands | `forms get`, `forms submit`, `send`, `status`, `auth login/status/logout`, `config` behave exactly as on `master` |
| C6 | Key is never exposed | Never printed unmasked (human or `--json`); entered via masked prompt only (never argv); config file stays mode `0600` |
| C7 | Binary exports are real files | CSV opens with correct header row + one row per submission; PDF opens in a viewer and matches the submission |

---

## 3. Pre-flight / environment

- [ ] PR head checked out: `gh pr checkout 33 --repo Paubox/paubox-cli` (or `git checkout feat-scoped-api-keys`)
- [ ] Node ≥ 18 (CLI relies on built-in `fetch`); `npm ci` completed
- [ ] Built and linked: `npm run build && npm link` (or invoke via `npm run dev -- <args>` throughout)
- [ ] A **scoped API key with the `forms` scope** for the test customer (from the Paubox dashboard / IAM)
- [ ] A second key **without** the `forms` scope (e.g. `email_api` only) for the negative test in §7
- [ ] The test customer's numeric `customer_id`
- [ ] On that customer: ≥1 active form with **≥3 submissions** (distinct emails/timestamps so sorting is observable), incl. at least one submission with an attachment or signature if available (PDF fidelity)
- [ ] A small JSON form definition file for `create`/`update` (copy `form_json` from an existing form via `forms list --form-id <id> --json`)
- [ ] For storage-matrix cases: one machine with a real keychain (macOS) **and** one without libsecret (Linux container) — or force the fallback by testing where keytar fails to load

Environment record: date ______ · tester ______ · deployment (prod / staging+patch) ______ · Node ______ · OS ______

---

## 4. Automated gates (C1) — run locally

```bash
npm run typecheck && npm run lint && npm test && npm run test:coverage
```

- [ ] typecheck: 0 errors
- [ ] lint: 0 errors/warnings
- [ ] tests: 12/12 suites, 228/228 pass — confirm the **new** suites actually ran: `test/commands/forms-admin.test.ts`, extended `forms-api`, `auth`, `credentials`, `config-store`
- [ ] coverage: branches ≥ 70%, lines/functions ≥ 80%

---

## 5. Credential lifecycle & storage matrix (C2, C6)

Run each flow on **both** storage backends (keychain and file fallback). `auth status` prints which one is in use.

**5.1 Standalone forms key (no prior login)**
```bash
paubox auth logout
paubox auth set-forms-key        # paste key at masked prompt
paubox auth status
paubox auth status --json
```
- [ ] Save succeeds; status shows the forms key masked (`****<last4>`) and does **not** claim email-API authentication
- [ ] `--json`: `formsApiKey` is the **masked** string, never the raw key

**5.2 Forms key added after login**
```bash
paubox auth login                # valid email-API creds
paubox auth set-forms-key
paubox auth status
```
- [ ] Status shows both: email username + masked API key **and** masked forms key

**5.3 Re-login preserves the forms key (regression pin — this bug was found & fixed in review)**
```bash
paubox auth set-forms-key
paubox auth login                # log in again / rotate email creds
paubox auth status && paubox forms stats --customer-id <CID>
```
- [ ] Forms key still present after re-login; `forms stats` still works

**5.4 Logout clears everything**
- [ ] After `paubox auth logout`, `auth status` shows nothing; any `forms list` attempt → `AuthError` (§7.1)

**5.5 File-fallback specifics (Linux/no-libsecret only)**
```bash
stat -c '%a' ~/.config/paubox/config.json
```
- [ ] Mode is `600`; raw key **is** visible in this file (expected — documented fallback), but nowhere else
- [ ] Back-compat: with a pre-PR blob (`{"credentials":{"apiUsername":"u","apiKey":"k"}}`) hand-written into config.json, `auth status` loads fine and `set-forms-key` adds the key without dropping `u`/`k`

**5.6 Key never unmasked (C6)**
- [ ] Grep the full transcript of this session's stdout/stderr for the raw key — zero hits outside the §5.5 file itself
- [ ] Confirm no command accepts the key as a CLI argument (only the masked interactive prompt)

---

## 6. Command E2E (C3, C7) — against a real deployment

`CID=<customer_id>`, `FID=<form id>`, `SID=<submission id>`. Spot-check each command with and without `--json`.

**6.1 `forms list`**
```bash
paubox forms list --customer-id $CID
paubox forms list --customer-id $CID --items 2 --page 2
paubox forms list --customer-id $CID --search "<known title fragment>"
paubox forms list --customer-id $CID --archived true
paubox forms list --customer-id $CID --order-by submission_count --order desc
paubox forms list --customer-id $CID --form-id $FID --json
```
- [ ] One line per form + `Page X of Y (N forms total)`; pagination math matches `--json`'s `page_info`
- [ ] Search/archived/active filters and sort order verifiably applied

**6.2 `forms stats`**
- [ ] `paubox forms stats --customer-id $CID` prints active-forms / total-submissions / last-7-days counters consistent with the dashboard; bare `paubox forms stats` (no flag) also works (server defaults to the key's customer)

**6.3 `forms submissions`**
```bash
paubox forms submissions $FID
paubox forms submissions $FID --order-by submitter_email --order asc
paubox forms submissions $FID --submission-id $SID --json
```
- [ ] Rows show id / created_at / submitter email (`-` when absent); totals line matches `--json`; `--submission-id` narrows to 1

**6.4 Exports (C7)**
```bash
paubox forms export-csv $FID                       # → form-$FID-submissions.csv
paubox forms export-csv $FID $SID -o one.csv
paubox forms export-pdf $FID $SID                  # → submission-$SID.pdf
```
- [ ] Default filenames as above; `--output` honored
- [ ] CSV: header = `Created At` + form field labels; one data row per submission; opens clean in a spreadsheet
- [ ] PDF: opens in a viewer, shows the form title + the submission's answers (and signature image if the form has one)

**6.5 Lifecycle: `copy` → `update` → `archive` → `unarchive`**
```bash
paubox forms copy $FID --title "QA copy $(date +%s)"     # note new id → NEWID
paubox forms update $NEWID --description "edited by QA" --active false
paubox forms list --customer-id $CID --form-id $NEWID --json   # verify fields
paubox forms archive $NEWID && paubox forms unarchive $NEWID
```
- [ ] Copy returns the new form (same content, fresh id, no vanity URL); update changes **only** the sent fields (PPD-8759 class check: a form with a connected `subscription_list_id` keeps it after an unrelated update); archive/unarchive round-trip confirmed via `list --archived`
- [ ] Public sanity: `paubox forms get $NEWID` → 404-style "Form not found" while the copy is **inactive** (public endpoint only serves active forms) — expected, not a bug

**6.6 `forms create`**
```bash
paubox forms create --title "QA created form" --customer-id $CID \
  --form-json-file form.json --recipient qa@paubox.com --active
```
- [ ] Prints new id; form appears in `forms list` and (being active) in `forms get <id>`
- [ ] Submitting to it (`paubox forms submit <id> --data ...`) works end-to-end and the recipient gets the notification email

**6.7 Cleanup**
- [ ] Archive every form created/copied in this run

---

## 7. Error paths (C4)

| Case | Command | Expected |
|---|---|---|
| 7.1 No key stored | `paubox forms list --customer-id $CID` (after logout) | Exit 1, `No Forms API key configured.` + suggestion to run `paubox auth set-forms-key`; **no HTTP request sent** |
| 7.2 Invalid key | set a garbage key, any authed command | Exit 1, 401-mapped: key invalid or lacks the `forms` scope |
| 7.3 Wrong scope | key with only `email_api` scope | Same as 7.2 (server 401s keys without `forms`) |
| 7.4 Foreign customer | `forms list --customer-id <someone else's>` | Exit 1, 403-mapped `ApiError` with the check-your-customer-id suggestion |
| 7.5 Missing customer-id | `forms list` (flag omitted) | Commander required-option error, exit ≠ 0 |
| 7.6 Bad IDs | `forms submissions <bogus>` / `export-pdf $FID <bogus>` | Exit 1, "Form or submission not found." |
| 7.7 Option validation | `--customer-id abc` · `--active maybe` · `--order-by evil` · `forms update $FID` with no flags · `--form-json-file /nonexistent` and a non-JSON file | Each: exit 1 `ConfigError` naming the bad option; no request sent |
| 7.8 Items cap | `forms list --customer-id $CID --items 500` | No client error; server caps at 100 (`page_info.items` = 100) |

- [ ] All rows behave as specified; every error goes to **stderr** (stdout stays clean for `--json` pipelines)

---

## 8. Regression sweep (C5)

- [ ] `paubox forms get $FID` and `paubox forms submit $FID --data ... [--attach ...]` — unchanged, still work **without** any forms key stored
- [ ] `paubox send` / `paubox status <trackingId>` with email-API creds — unchanged (`Token token=` auth untouched)
- [ ] `paubox config set/get/list` — unchanged (shares config.json with the credential fallback; confirm no cross-corruption after §5 runs)
- [ ] Global flags: `--json` emits only JSON on stdout; `--quiet` suppresses informational output — spot-check on 2 new subcommands

---

## 9. Sign-off

| Criterion | Result (pass/fail) | Notes |
|---|---|---|
| C1 automated gates | | |
| C2 key lifecycle | | |
| C3 subcommands E2E | | |
| C4 error mapping | | |
| C5 no regressions | | |
| C6 key exposure | | |
| C7 export fidelity | | |

**Verdict:** ______ · Tester: ______ · Date: ______

Known limitations (not blockers, candidate follow-ups): hardcoded prod base URL (no staging override); no save-time validation of the forms key (first authed command is the validation); `forms create --form-html-file/--form-css-file` accept raw text without validation.
