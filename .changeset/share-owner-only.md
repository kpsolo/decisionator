---
"@decisionator/plugin-sdk": patch
"@decisionator/store-file": patch
"@decisionator/store-firestore": patch
"@decisionator/store-google-sheets": patch
---

Sharing is owner-only (ProjectStore contract v1.2.1). `share()` in store-file and store-firestore had no owner check, so any participant, even with the `view` role, could invite people, change roles, remove collaborators or toggle link sharing. They now reject non-owners with `PERMISSION_DENIED`, as store-google-sheets, store-local and the example memory store already did. store-google-sheets now honours `removeUsers` by deleting the collaborator's Drive permission (the owner's permission is never touched). While link sharing stays on it throws `NOT_SUPPORTED` before changing anything, because Drive cannot exclude one person from an "anyone with the link" permission. The contract kit covers both rules.
