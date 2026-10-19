---
"@decisionator/store-file": patch
"@decisionator/store-local": patch
"@decisionator/store-firestore": patch
---

Store integrity fixes.

- File and local stores no longer lose writes when two tabs (or two store instances on the same IndexedDB database) change a project at once: every read-modify-write runs under the Web Lock `decisionator:project:<id>` (a shared in-page chain where Web Locks are missing) and reads the document inside the lock. Changes are announced on a `BroadcastChannel` of the same name, so `watch` also reports changes made in other tabs.
- File store: a password-protected project written to its linked JSON file now carries `project.kdf` (`pbkdf2-sha256`, salt, iterations, verifier), so the file can be unlocked again. A failed write of the linked file is no longer swallowed: the change stays in the browser and the error (`FILE_WRITE_FAILED: …`) is available from `getFileSyncError(projectId)` and `onFileSyncError(listener)`.
- In password-protected projects every user-content field of an option is encrypted (title, description, category, tags, pros, cons, link titles and URLs) in all three stores; values stored in plaintext by older versions still read back.
- Contributions are stamped with the signed-in author and the append time instead of the caller's `by`/`at` (ProjectStore rule 1), and an `outcome` appended by anyone but the owner is refused with `PERMISSION_DENIED`, writing nothing from that call.
