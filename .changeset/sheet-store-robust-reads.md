---
"@decisionator/store-google-sheets": patch
"@decisionator/plugin-sdk": minor
---

ProjectStore contract v1.3.0: `ProjectSnapshot` gains an optional `warnings: string[]` listing stored records the store skipped because they failed validation. The project page shows them.

Google Sheets store fixes:
- `enablePassword` now encrypts the `contributions` tab too. Before, a project with contributions could no longer be opened once a password was set. It also encrypts payloads in place and sets the protection keys by name, so no plaintext row is left behind and unknown `meta` keys are kept. Calling it on a project that is already protected is rejected.
- `openProject` validates each row on its own (the format v1 rule for direct edits in Google Sheets). A malformed or undecryptable row, or a broken `voting` meta value, is skipped and reported in `snapshot.warnings` as `"<tab> row <n>: <reason>"` instead of making the whole project unavailable.
- A ranking appended without `round` is recorded for the project's current voting round instead of round 1.
- The format v1 to v2 migration works against the real API: when the read fails because the `contributions` tab is missing, the store lists the tabs, reads the others, adds the tab with `spreadsheets.batchUpdate` (`addSheet`) and writes the `formatVersion` meta row in place. Before, the read failed outright, and the migration overwrote the meta header row. Viewers open such projects without contributions.

Plugin SDK testing: the fake Google backend now behaves like Sheets for ranges and tabs. `values.batchUpdate` writes only the addressed cells of an A1 range and rejects values that do not fit. `values.batchGet` returns only the requested range, trimmed of empty trailing cells and rows. Reads, writes and appends that name a missing tab fail with 400. It also supports `spreadsheets.get` (tab titles) and `spreadsheets.batchUpdate` with `addSheet`.
