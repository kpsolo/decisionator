---
"@decisionator/plugin-sdk": minor
"@decisionator/core": minor
"@decisionator/store-file": patch
"@decisionator/store-local": patch
"@decisionator/store-firestore": patch
"@decisionator/store-google-sheets": patch
---

Delegated append (ProjectStore contract v1.2.0). `append(ref, entries, { onBehalfOf: { participantId, displayName? } })` lets the project owner record grades, comments and rankings for another participant, such as a live-session guest whose vote is relayed through the owner's tab or the original author when a project is moved between stores. Delegated entries are stamped `by: participantId` with the new optional `byName` on `Grade`, `Comment` and `Ranking`. Latest-wins is keyed on the stamped author, so a guest's grade no longer overwrites the owner's and guests no longer overwrite each other. Non-owners and delegated `outcome`/`contribution` entries get `PERMISSION_DENIED`, and malformed delegates get `INVALID_ARGUMENT`. Nothing from a rejected call is written. The plugin SDK exports `resolveDelegatedAuthor` and `readStoredByName` for store authors, and the contract kit covers delegation.

All first-party stores implement it. Google Sheets keeps `byName` inside the existing JSON payload column, so the sheet layout is unchanged. Store fixes:
- store-file: password-protected projects no longer store comment bodies in plaintext, which used to make the next open fail with "Invalid encrypted payload format". Empty hide/unhide comment bodies and option or title edits no longer break them either. The key from a successful unlock is kept in memory for the session, so watchers fire for protected projects. Appending to a protected project that has not been unlocked fails with "Password required". Concurrent writes to one project are serialized, so no update is lost.
- store-google-sheets: appends to password-protected projects are encrypted. Previously they were written in plaintext, which made the project unreadable. Option and meta updates of protected projects are encrypted too, and `updateMeta` addresses meta rows by key instead of fixed cells, which used to overwrite the description or the KDF iterations.
- store-local: ranking latest-wins is now per (author, round) instead of per author.
