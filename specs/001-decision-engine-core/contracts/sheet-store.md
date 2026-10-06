# Contract: Google Sheets Project Store — format v1

Normative layout of a project stored as a Google Sheet. It implements
[project-store.md](./project-store.md). Decisions behind it are in research R19–R23 and R28.

## Google access

| Item | Value |
|------|-------|
| OAuth | Google Identity Services token model, scope `drive.file` only, token in memory |
| APIs | Drive v3 (`files.create`, `files.get`, `files.list`, `permissions.*`, `about.get`), Sheets v4 (`spreadsheets.create`, `values.batchGet`, `values.append`, `values.batchUpdate`), Picker (`setFileIds`) |
| File tag | Drive `appProperties`: `decisionator=project`, `formatVersion=1` |
| Share link | `https://kpsolo.github.io/decisionator/#/p/<fileId>` (base URL configurable, R28) |

## Tabs and columns

Row 1 of every tab is a header row, and data starts at row 2. The `payload` column holds JSON.
In password mode it holds `enc:v1:<base64 iv>:<base64 ciphertext>` instead (AES-256-GCM over the
JSON, research R22). Timestamps are ISO-8601 UTC. `by` is the author's participant ID: the Google
account email, stamped by the store.

| Tab | Columns | Written by | Semantics |
|-----|---------|-----------|-----------|
| `meta` | `key`, `value` | owner | Key/value rows, listed below. |
| `options` | `id`, `order`, `status`, `at`, `by`, `payload` | owner | One row per option. `payload` = option fields from [options-format.schema.json](./options-format.schema.json). `status` is `active` or `removed`. The owner updates rows in place (`values.batchUpdate`). |
| `grades` | `id`, `at`, `by`, `optionId`, `payload` | contributors | **Append-only.** `payload` = `{"value": 1..5}`. The latest row per (`by`, `optionId`) counts. |
| `comments` | `id`, `at`, `by`, `optionId`, `payload` | contributors | **Append-only.** `payload` = `{"body": markdown, "replaces"?: id, "hidden"?: bool}`. Edits and hides are new rows that reference `replaces`. Only the owner may hide others' comments. |
| `rankings` | `id`, `at`, `by`, `payload` | contributors | **Append-only.** `payload` = `{"ranking": [optionId…], "round": n}`. The latest row per (`by`, `round`) counts. |
| `outcomes` | `id`, `at`, `by`, `payload` | owner | **Append-only.** `payload` = an OutcomeRecord ([data-model.md](../data-model.md)). |
| `contributions` | `id`, `at`, `by`, `targetKind`, `targetId`, `payload` | agents & contributors | **Append-only.** Added in format v2 (US5). `payload` = `{type, body, pros?, cons?, sources[], author, reviewStatus: "pending" | "accepted" | "edited" | "dismissed"}`. |

**`meta` keys**:
- `formatVersion` (`1` or `2`)
- `title`, `description` (encrypted in password mode)
- `protected` (`true` / `false`), `kdf` (`pbkdf2-sha256`), `kdfIterations`, `salt`, `verifier`
- `voting` (`{"state": "open" | "closed", "round": n, "topN": 3, "liveResults": true}`)
- `createdAt`, `owner`

### Format v1 to v2 Migration (US5)
When opening a project with `formatVersion = 1`:
1. If the `contributions` tab does not exist, the store appends `contributions` to the spreadsheet tabs via `spreadsheets.batchUpdate` with the header row `["id", "at", "by", "targetKind", "targetId", "payload"]`.
2. The store updates `meta.formatVersion` to `2`.
3. If the user lacks write permission to update tabs (e.g. view-only collaborator), the store treats `contributions` as an empty list without failing.

In password mode, readable `meta` values reveal nothing about the content beyond counts and
timestamps. The `by` column (participants' emails), `optionId` columns and `at` timestamps stay
readable too (spec FR-017); the UI discloses this when a password is set.

**Validation**: the host validates every row. A row that fails validation is skipped, and the UI
shows a warning naming the tab and row (spec edge case: direct edits in Google Sheets). A row in
a contributor tab whose `by` does not match a known participant is still shown, but flagged.

## Sync and quota budget (research R23)

| Action | API call | Frequency |
|--------|----------|-----------|
| Change check | Drive `files.get?fields=version` | every 10 s while the tab is visible |
| Full read | Sheets `values.batchGet` (all tabs) | only when `version` changed; ≤ 1 per 15 s |
| Write | Sheets `values.append` per tab | queued; flushed ≤ every 2 s |
| Back-off | on 429 / `rateLimitExceeded` | truncated exponential, jitter, max 64 s |
| Client budget | — | ≤ 20 Sheets reads and ≤ 20 writes per minute per client |

Free quota reference (2026-10-05):
- Sheets: 300 reads and 300 writes per minute per project, 60 per minute per user.
- Drive: 1 M units per minute per project, 400 M units per day; `files.get` = 5 units.

## Sharing operations

| Deci action | Drive call |
|-------------|-----------|
| Link: view | `permissions.create {type: anyone, role: reader, allowFileDiscovery: false}` |
| Link: contribute | `permissions.create {type: anyone, role: writer, allowFileDiscovery: false}` |
| Link off | `permissions.delete` (the `anyone` permission) |
| Delete project (owner) | `files.update {trashed: true}` (recoverable from the owner's Drive trash) |
| Invite / remove by email | `permissions.create {type: user, emailAddress, role}` / `permissions.delete` |
| Collaborator first open | Picker with `setFileIds([fileId])` → app gains `drive.file` access to the file (spike in Increment 0, fallbacks in research R21) |

## Export (FR-080)

`export` returns the decrypted snapshot as `decisionator.project/v1` JSON. The same structure is
used to import into local mode in US7.

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 2.0.0 | 2026-10-05 | Add `contributions` tab and automatic migration from v1 for agent and research contributions (US5) |
| 1.1.0 | 2026-10-05 | Add delete project operation (`files.update {trashed: true}`) per FR-025; disclose readable metadata fields (`by`, `optionId`, `at`) in password mode per FR-017 and SC-007 |
| 1.0.0 | 2026-10-05 | Initial Google Sheets store format specification |

