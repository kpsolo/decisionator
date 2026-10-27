---
"@decisionator/core": minor
"@decisionator/store-google-sheets": minor
"@decisionator/store-file": patch
"@decisionator/store-local": patch
"@decisionator/store-firestore": patch
---

Store and password-codec hardening (security audit F3, F4, F6, F10, F11, F13, F15).

- Core codec v2: `encrypt(plaintext, key, context?)` writes `enc:v2:` values sealed with AES-GCM additional data built from a seal context (`SealContext`, e.g. `["option", id, "title"]`), so a ciphertext copied to another record or field no longer decrypts. `decrypt(value, key, context?)` still reads legacy `enc:v1:` values (no additional data). New helpers: `isSealed`, `checkKdfIterations` (iteration counts from stored data must lie in [100 000, 5 000 000]), `assertPasswordStrength` (at least 12 characters), and the constants `SEALED_PREFIX_V1/V2`, `KDF_MIN/MAX/DEFAULT_ITERATIONS`, `MIN_PASSWORD_LENGTH`.
- All four stores seal every value with its context (meta title/description/strategy, each option field, comment bodies, property values; Sheets payloads are bound to their tab and every column before the payload), bound KDF iterations read from stored data, and refuse passwords shorter than 12 characters when one is set.
- Downgrade guard: once a project's key is loaded (or, in Sheets, the project was seen protected) the store never writes it in plaintext; a document or meta tab that now says "not protected" yields `PROTECTION_DOWNGRADE`. Sheets also pins `salt`, `verifier` and `kdfIterations` at the first unlock and treats a later change as `PROTECTION_TAMPERED`.
- Sheets: copies of an entry id with different content are all skipped with a warning (identical copies still count once); the options `by` column now holds the option's author, and a row whose payload `by` disagrees with a non-owner `by` column is skipped; an append whose permission lookup fails is refused unless a role was already seen in the session; share links use the running app's origin and path (`projectLinkUrl`), with the public app URL only as a fallback outside a page. The sheet-store contract (2.4.0) documents the trust model: Drive writers can forge authorship and outcomes.
- store-firestore is labelled as what it is: an experimental in-memory mock with no network sync and no server-side security. Its manifest no longer claims real-time sync or requests Firestore network permissions, and the README lists what a real backend's `firestore.rules` must enforce.
