# Export & restore a project

Every project can be saved to a file and restored from it — for a backup, to move it to another
device or browser, or to work on the data in a spreadsheet.

## User flow

1. **Create** — *+ New Decision Project*, paste ideas (one per line, or an agent's options JSON),
   *Use as plain list*, set the title, *Create Project →*.
2. **Grade & comment** — rate options 1–5 ★ and comment on the *Options & Grading* tab.
3. **Vote** — *Vote*, order the options with drag-and-drop or the ↑/↓ buttons, *Submit Ballot*.
4. **View the ranking** — *Results*, pick a ranking system (strategy) and *Decide with …*. The
   ranked order, points (Borda) and the system used (“Ranked by: …”) are shown.
5. **Change the ranking system** — pick another strategy and decide again. The newest outcome is
   the one in force; earlier ones stay listed under *Decision History*, and the strategy picker
   starts from the one in force.
6. **Export** — project menu (**⋯**):
   - **Export Project (JSON)** → `<title>-export.json`
   - **Export Project (Excel / Google Sheets)** → `<title>-export.xlsx`
7. **Restore** — on the home page, *Open from File…* (or drag the file onto the drop zone) and
   pick the `.json` or `.xlsx` file. A new local project is created with all the data below and
   opens immediately. Restoring never overwrites an existing project.

To use the workbook in **Google Sheets**: in Drive, *New → File upload*, then open the file with
Google Sheets (or *File → Import* in an existing sheet). To restore after editing it there,
*File → Download → Microsoft Excel (.xlsx)* and open that file in Deci.

## What is exported and restored

| Data | JSON | Excel sheet | Restored |
| --- | --- | --- | --- |
| Title, description, voting state, round, ballot size (top N), live results | `project` | Project | ✓ |
| Options: ID, order, status, title, description, category, tags, pros, cons, effort, links | `options` | Options | ✓ (same IDs) |
| Grades (1–5) with author | `grades` | Grades | ✓ under the original author |
| Ballots (ranked option IDs, per round) with author | `rankings` | Ballots | ✓ under the original author |
| Comments, incl. hidden flag | `comments` | Comments | ✓ under the original author |
| Outcomes: strategy, settings, seed, inputs, result order and points | `outcomes` | Outcomes | ✓ verbatim — *Verify Outcome* still reproduces them |
| Agent / human contributions | `contributions` | Contributions | ✓ verbatim |
| Current ranking (derived) | — | Ranking | — (recomputed) |

Entries by other people (e.g. live-session guests) are re-recorded on their behalf
(`append(..., { onBehalfOf })`, ProjectStore v1.2.0), so each person keeps one grade per option
and one ballot per round. Entry IDs and timestamps of grades, ballots and comments are assigned
anew by the store; outcomes and contributions keep theirs. Password protection is not carried
over: the export holds the decrypted content, and the restored project is unprotected.

## JSON bundle: `decisionator.project/v1`

Schema: `packages/core/schema/project-export-v1.schema.json` (generated from
`ProjectExportV1Schema` in `packages/core/src/export/project-v1.ts` by `scripts/gen-schemas.ts`).

```json
{
  "format": "decisionator.project/v1",
  "exportedAt": "2026-10-06T10:00:00.000Z",
  "project": { "title": "…", "description": "…", "voting": { "state": "open", "round": 1, "topN": 3, "liveResults": true } },
  "options": [ … ], "grades": [ … ], "comments": [ … ], "rankings": [ … ],
  "outcomes": [ … ], "contributions": [ … ]
}
```

`contributions` and the outcome fields `inputs.settings` / `inputs.runInput` were added in
core 0.2 and are optional, so bundles from older versions still load.

## Excel workbook layout

Written by `createProjectWorkbook` and read by `readProjectWorkbook`
(`packages/core/src/export/project-xlsx.ts`). Row 1 of every sheet is a header; columns are
matched **by header name**, so they can be reordered and extra columns are ignored.

| Sheet | Columns |
| --- | --- |
| **Project** | `Field` / `Value` rows: Format, Exported at, Title, Description, Owner, Created at, Voting state (`open`/`closed`), Voting round, Ballot size (top N), Live results, Ranked by (latest outcome — informational) |
| **Ranking** | Rank, Option, Points, 1st places, Average grade, Grades, Ballots listing it, Comments, Option ID — order of the latest outcome of the current round, or by average grade if none. *Not read on restore.* |
| **Options** | ID, Order, Status, Title, Description, Category, Tags, Pros, Cons, Effort, Links, Added at, Added by |
| **Grades** | ID, Option ID, Option, Value, By, By name, At |
| **Ballots** | ID, Round, By, By name, At, Ranking (option IDs), Choice 1…N (titles) |
| **Comments** | ID, Option ID, Option, Body, By, By name, At, Replaces, Hidden |
| **Outcomes** | ID, Round, At, Strategy, Strategy version, Winner ID, Winner, Tie-break, Seed, Triggered by, Explanation, Record (JSON)… |
| **Contributions** | ID, At, By, Target kind, Target ID, Type, Review status, Body, Record (JSON)… |

Rules for restore:

- Lists (tags, pros, cons, links, ballot rankings) are one item per line within the cell. A link
  is `url` or `title | url`.
- Outcomes and contributions are restored from their `Record (JSON)` cell(s); the other columns
  are for reading. A record longer than one cell holds is split over `Record (JSON)`,
  `Record (JSON) 2`, … and joined back in order.
- Rows added by hand may leave ID and time empty. A ballot row with an empty
  `Ranking (option IDs)` is read from its `Choice N` cells, matching option titles.
- An invalid value is reported with its sheet and row, e.g.
  `Grades row 2 (value): Invalid literal value, expected 5`.

## Code map

| Piece | Location |
| --- | --- |
| Bundle schema, `createProjectExport` | `packages/core/src/export/project-v1.ts` |
| Workbook ↔ bundle | `packages/core/src/export/project-xlsx.ts` |
| Minimal `.xlsx` writer / reader (fflate) | `packages/core/src/export/xlsx.ts` |
| Download, file parsing, restore | `apps/web/src/features/project/project-file.ts` |
| Re-recording entries under their authors | `apps/web/src/features/project/copy-entries.ts` |
| Tests | `packages/core/test/export/`, `apps/web/src/features/project/project-file.test.ts`, `apps/web/e2e/export-restore.spec.ts` |
