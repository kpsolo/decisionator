---
"@decisionator/core": minor
---

Project export & restore carries all project data and has an Excel form:

- `decisionator.project/v1` bundles include `contributions` (optional; older bundles still load).
- Outcome records keep `inputs.settings` and `inputs.runInput`. They used to be dropped on
  export, so restored owner-pick or weighted outcomes failed verification.
- New `createProjectWorkbook` / `readProjectWorkbook`: the bundle as an `.xlsx` workbook
  (Project, Ranking, Options, Grades, Ballots, Comments, Outcomes, Contributions sheets) that
  Excel and Google Sheets open and that restores the project, also after being edited and
  re-saved. Built on the generic `writeWorkbook` / `readWorkbook` codec.
- New `latestOutcome(outcomes, round)` helper: the outcome currently in force.
- Regenerated JSON schemas under `packages/core/schema` (they were missing `byName` and other
  recent fields).
