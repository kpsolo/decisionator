# Contract: Google Sheets Project Store — format v1

Normative layout of a project stored as a Google Sheet. It implements
[project-store.md](./project-store.md). Decisions behind it are in research R19–R23 and R28.

## Google access

| Item | Value |
|------|-------|
| OAuth | Google Identity Services token model, scope `drive.file` only, token in memory |
| APIs | Drive v3 (`files.create`, `files.get`, `files.list`, `permissions.*`, `about.get`), Sheets v4 (`spreadsheets.create`, `values.batchGet`, `values.append`, `values.batchUpdate`; `spreadsheets.get` and `spreadsheets.batchUpdate` only for the migrations), Picker (`setFileIds`) |
| File tag | Drive `appProperties`: `decisionator=project`, `formatVersion=1` |
| Share link | `<app origin + path>#/p/<fileId>`, taken from the running page (`location`); `https://kpsolo.github.io/decisionator/` only when there is no page (R28) |

## Tabs and columns

Row 1 of every tab is a header row, and data starts at row 2. The `payload` column holds JSON.
In password mode it holds `enc:v2:<base64 iv>:<base64 ciphertext>` instead (AES-256-GCM over the
JSON, research R22) — see **Password mode codec** below. Timestamps are ISO-8601 UTC. `by` is the
author's participant ID: the Google account email, stamped by the store.

| Tab | Columns | Written by | Semantics |
|-----|---------|-----------|-----------|
| `meta` | `key`, `value` | owner | Key/value rows, listed below. |
| `options` | `id`, `order`, `status`, `at`, `by`, `payload` | owner | One row per option. `payload` = option fields from [options-format.schema.json](./options-format.schema.json). `status` is `active` or `removed`. The owner updates rows in place (`values.batchUpdate`). Since layout 2.4.0 the `by` column holds the option's author, like the payload's `by`; older rows hold the owner who last rewrote the row. A row whose payload `by` differs from a `by` column that is not the owner is skipped with a warning. |
| `grades` | `id`, `at`, `by`, `optionId`, `payload` | contributors | **Append-only.** `payload` = `{"value": 1..5, "byName"?: string}`. The latest row per (`by`, `optionId`) counts. |
| `comments` | `id`, `at`, `by`, `optionId`, `payload` | contributors | **Append-only.** `payload` = `{"body": markdown, "replaces"?: id, "hidden"?: bool, "byName"?: string}`. Edits and hides are new rows that reference `replaces`. Only the owner may hide others' comments. |
| `rankings` | `id`, `at`, `by`, `payload` | contributors | **Append-only.** `payload` = `{"ranking": [optionId…], "round": n, "byName"?: string}`. The latest row per (`by`, `round`) counts. |
| `outcomes` | `id`, `at`, `by`, `payload` | owner | **Append-only.** `payload` = an OutcomeRecord ([data-model.md](../data-model.md)). |
| `contributions` | `id`, `at`, `by`, `targetKind`, `targetId`, `payload` | agents & contributors | **Append-only.** Added in format v2 (US5). `payload` = `{type, body, pros?, cons?, sources[], author, reviewStatus: "pending" | "accepted" | "edited" | "dismissed"}`. |
| `properties` | `id`, `at`, `by`, `optionId`, `payload` | owner (`shared`), contributors (`person`) | **Append-only.** Added in layout 2.3.0 (feature 005, option-properties contract). `payload` = `{"plugin": id, "key": key, "scope": "shared" \| "person", "value": string \| number \| boolean \| null, "byName"?: string}`. The latest row per (`plugin`, `key`, `optionId`) counts for `shared`, per (`by`, `plugin`, `key`, `optionId`) for `person`; on an equal `at` the later row wins. `value: null` clears the value. Only the owner may append `shared` rows. |
| `resets` | `id`, `at`, `by`, `payload` | owner; contributors (own property values only) | **Append-only.** Added in layout 2.3.0 (feature 005, history-resets contract). `payload` = `{"scope": "all" \| "participant", "participantId"?: id, "targets": ["grades" \| "ballots" \| "properties", …], "round"?: n, "plugin"?: id, "key"?: key, "byName"?: string}`. A reset clears matching `grades`, `rankings` and `properties` rows with an earlier `at`; nothing is deleted. Rows of every tab are read in append order and latest-wins and resets are applied with `effectiveEntries`; superseded and cleared rows and every reset are returned as `ProjectSnapshot.history`. The store stamps `at` with strictly increasing times. A non-owner (and the owner delegating) may only append `{"scope": "participant", "participantId": <self>, "targets": ["properties"], "plugin", "key"}`. |

**`meta` keys**:
- `formatVersion` (`1` or `2`)
- `title`, `description` (encrypted in password mode)
- `protected` (`true` / `false`), `kdf` (`pbkdf2-sha256`), `kdfIterations`, `salt`, `verifier`
- `voting` (`{"state": "open" | "closed", "round": n, "topN": 3, "liveResults": true}`)
- `createdAt`, `owner`
- `strategy` (layout 2.3.0, optional): `{"id", "version", "settings", "at", "by"}`, the chosen
  decision strategy; JSON, encrypted in password mode like the title. Written by the owner only
  (`updateMeta`), the store stamps `at` and `by`. Absent for older projects (Borda count with
  `voting.topN`).
- `strategyChanges` (layout 2.3.0, optional): `[{"id", "at", "by"}, …]`, the last 20 strategy
  changes, oldest first; JSON, encrypted in password mode like the title.

### Format v1 to v2 Migration (US5)
When opening a project with `formatVersion = 1`:
0. A `values.batchGet` that names a missing tab fails as a whole, so when the full read is rejected
   the store lists the tabs (`spreadsheets.get?fields=sheets.properties.title`) and, if only
   tabs added since format v1 (`contributions`, `properties`, `resets`) are missing, reads the
   other tabs.
1. If the `contributions` tab does not exist, the store appends `contributions` to the spreadsheet tabs via `spreadsheets.batchUpdate` with the header row `["id", "at", "by", "targetKind", "targetId", "payload"]`.
2. The store updates `meta.formatVersion` to `2`, writing that row in place (never `meta!A:B`
   from the top, which would overwrite the header).
3. If the user lacks write permission to update tabs (e.g. view-only collaborator), the store treats `contributions` as an empty list without failing.

### Properties and resets tab migration (layout 2.3.0)
When opening a project that has no `properties` or no `resets` tab (created before layout
2.3.0), the store detects it as in step 0 above, and an owner or contributor adds each missing
tab with `spreadsheets.batchUpdate` (`addSheet`) and its header row (`["id", "at", "by",
"optionId", "payload"]` for `properties`, `["id", "at", "by", "payload"]` for `resets`), in the
same calls as the v1 to v2 migration when both apply. `formatVersion` stays `2`: the change is
additive. A viewer cannot add the tabs and sees no properties and no resets.

In password mode, readable `meta` values reveal nothing about the content beyond counts and
timestamps. The `by` column (participants' emails), `optionId` columns and `at` timestamps stay
readable too (spec FR-017); the UI discloses this when a password is set.

**Validation**: the store validates every row. A row that fails validation (bad JSON, schema,
or a payload that does not decrypt) is skipped and reported in `ProjectSnapshot.warnings` as
`"<tab> row <n>: <reason>"`, with the 1-based sheet row; the UI shows these warnings (spec edge
case: direct edits in Google Sheets). An invalid `voting` meta value falls back to the defaults
and is reported as `meta row <n>`. A row in
a contributor tab whose `by` does not match a known participant is still shown, but flagged.

**Duplicate ids** (append-only tabs): identical copies of a row (a write queue flushed twice)
count once. Copies of one `id` whose content differs are a conflict — e.g. a row inserted in the
sheet to shadow someone's entry — and **every** copy is skipped with one warning
(`"<tab> row <n>: id <id> appears more than once with different content; every copy is ignored"`),
so neither the original nor the inserted row wins.

## Password mode codec

- Key: PBKDF2-HMAC-SHA-256 over the password with the `salt` meta value, `kdfIterations`
  iterations (written as 600 000), AES-256-GCM. New passwords must have at least 12 characters
  (`createProject` and `enablePassword` refuse shorter ones before writing anything).
- `kdfIterations` is read from the sheet, which every writer can edit: a value outside
  [100 000, 5 000 000] is refused (`INVALID_KDF`) instead of used.
- Values are `enc:v2:<iv>:<ciphertext>`: AES-GCM with **additional data** that names where the
  value lives, so a ciphertext copied to another row or field no longer decrypts:
  - meta values: `["decisionator/aad/v2", "meta", <key>]` (`title`, `description`, `strategy`,
    `strategyChanges`); the verifier: `[..., "verifier"]`;
  - payloads: `["decisionator/aad/v2", "row", <tab>, <every column before payload>]`, e.g.
    `grades` binds `id`, `at`, `by` and `optionId`; editing any of those columns makes the row
    fail to decrypt (skipped with a warning).
  The additional data is the UTF-8 JSON of that array. The spreadsheet id is not part of it: the
  key already differs per project (random salt), and a copied spreadsheet must stay readable.
- `enc:v1:` values (no additional data) written before layout 2.4.0 are still read; every write
  produces `enc:v2:`. There is no bulk re-encryption: v1 rows keep the old (swappable) property
  until they are rewritten.
- **Downgrade guard**: once a project is seen protected or unlocked in a session, the store never
  believes a later `protected=false` in `meta` (`PROTECTION_DOWNGRADE`: `openProject` and writes
  that read meta fail; other writes still go out encrypted with the session key). Nothing is
  written in plaintext while the project's key is loaded. A change of `salt`, `verifier` or
  `kdfIterations` after the first unlock in the session is treated as tampering
  (`PROTECTION_TAMPERED`) and the pinned values are kept. `forgetProject` clears this state.

## Trust model (what Drive writers can forge)

Google Drive has one write permission per file: everyone with `writer` access (a "contribute"
collaborator, or anyone with a contribute link) can edit **any cell of any tab** in the Sheets
UI or the API, bypassing the store. All role and authorship rules in this contract are enforced
by the Deci client only. Concretely, a writer can:

- append or edit rows with any `by` (impersonate another participant or the owner), any `at`, or
  any `optionId`; fabricate `outcomes` rows; change other people's grades, ballots, comments and
  properties; delete rows;
- edit the `meta` tab (`owner`, `voting`, `strategy`, the protection keys) and the `options` tab;
- in password mode, without the password: delete or reorder encrypted rows, replay an old
  ciphertext in its own row, re-add `enc:v1:` legacy values, or break rows (they are skipped). They
  cannot read or create valid ciphertext, and v2 values cannot be moved to another row or field.

The store makes such edits **visible or inert where it can** (skipped-row warnings, duplicate-id
conflicts, author mismatch on options, AAD on encrypted payloads, downgrade and KDF tamper
guards), but **authorship and outcome integrity against collaborators are not guaranteed**. Share
"contribute" access only with people trusted not to tamper with the sheet; use a live session
(the host mediates every write) or a future server-backed store for untrusted participants.
Viewers (`reader`) cannot change anything. When the permission lookup is rate limited or offline,
an append uses the role seen earlier in the session (Drive refuses the queued rows on flush if
access was revoked); with no role seen yet, the append fails.

**Visibility of per-person properties**: Per-person values are shown in the app only to their author, but anyone with access to the spreadsheet can read the raw properties tab, as with grades.

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
| 2.4.0 | 2026-10-27 | Security hardening (audit F3, F4, F6, F10, F11, F15): codec `enc:v2:` with AES-GCM additional data binding meta keys and row columns (`enc:v1:` still read); `kdfIterations` bounded to [100 000, 5 000 000]; passwords of at least 12 characters in `createProject` and `enablePassword`; downgrade and KDF-tamper guards; conflicting duplicate ids skip every copy; options `by` column holds the author and a mismatching row is skipped; append without a known role refused; share link from the running app's origin; documented trust model |
| 2.3.0 | 2026-10-07 | Add the `resets` tab (`id`, `at`, `by`, `payload`) and the `strategy` and `strategyChanges` meta keys (project-store contract v1.4.0, history-resets and strategy-choice contracts); `resets` is added by the same migration as `properties`; reset payloads and both meta values are encrypted in password mode (and by `enablePassword`); the store keeps every grade, ballot and property row and applies latest-wins and resets on read, returning the rest as `history`; new rows are stamped with strictly increasing times |
| 2.3.0 | 2026-10-07 | Add the `properties` tab (`id`, `at`, `by`, `optionId`, `payload`) for plugin-defined option properties (project-store contract v1.4.0); added by migration when missing on open, `formatVersion` stays 2; encrypted in password mode and by `enablePassword` like the other payload tabs; per-person values are readable in the raw tab |
| 2.2.0 | 2026-10-06 | Skipped rows reported in `ProjectSnapshot.warnings` (project-store contract v1.3.0); v1 to v2 migration lists tabs and adds `contributions` with `spreadsheets.batchUpdate` (`addSheet`) and writes the `formatVersion` row in place; `enablePassword` encrypts every content tab, `contributions` included |
| 2.1.0 | 2026-10-06 | `grades`, `comments` and `rankings` payloads may carry `byName`, the display name of a delegated author (project-store contract v1.2.0). The column layout is unchanged; readers ignore a missing or malformed `byName` |
| 2.0.0 | 2026-10-05 | Add `contributions` tab and automatic migration from v1 for agent and research contributions (US5) |
| 1.1.0 | 2026-10-05 | Add delete project operation (`files.update {trashed: true}`) per FR-025; disclose readable metadata fields (`by`, `optionId`, `at`) in password mode per FR-017 and SC-007 |
| 1.0.0 | 2026-10-05 | Initial Google Sheets store format specification |

