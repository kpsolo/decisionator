---
"@decisionator/store-local": patch
"@decisionator/store-firestore": patch
---

Password-protected projects in the local and Firestore stores now behave like the file and Google Sheets stores:
- Comment bodies are stored encrypted. Previously they were stored in plaintext. Empty hide/unhide comment bodies stay empty, and plaintext bodies written by older versions are still readable.
- Option edits and title or description changes are encrypted too. The local store also encrypts option pros and cons.
- The key from a successful unlock is kept in memory for the session. Password-less `openProject` and `watch` reuse it, so watchers fire for protected projects and these projects can be hosted in a live session.
- Writes to a protected project that has not been unlocked in this session fail with "Password required" instead of writing plaintext.
- store-local: a wrong password fails with "Incorrect password", which the app recognizes, instead of "Invalid password". Concurrent writes to one project are serialized, so no update is lost. Option updates no longer fail with an Automerge "Cannot create a reference to an existing document object" error.
- store-firestore: ciphertext that cannot be decrypted makes `openProject` fail instead of returning the ciphertext as text.
