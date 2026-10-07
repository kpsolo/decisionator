---
"@decisionator/core": minor
"@decisionator/plugin-sdk": minor
"@decisionator/store-file": minor
"@decisionator/store-local": minor
"@decisionator/store-firestore": minor
"@decisionator/store-google-sheets": minor
"@decisionator/web": minor
"@decisionator/option-status": minor
---

ProjectStore 1.4.0 history, resets and decision method.

- **History:** stores keep every grade, ballot and property value. `effectiveEntries` applies
  latest-wins and new `reset` entries, and exposes the superseded entries as `snapshot.history`.
  New entries are stamped with `monotonicNow()`.
- **Resets:** the owner can reset all votes or one participant's. Anyone can reset their own
  property values, such as seen marks. Earlier outcomes still verify.
- **Decision method:** projects store their method in `project.strategy`, with the last 20
  changes. "Close voting" uses it. The app shows "Decided by: …" and can compare every enabled
  strategy with seeds derived from the inputs, then adopt one result as a new outcome.
- **Google Sheets:** layout 2.3.0 adds the `resets` tab in the same migration as `properties`.
