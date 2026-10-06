# Contract: Firestore Project Store — v1.0.0

Plugin ID: `org.decisionator.store.firestore`  
Interface: Implements `ProjectStore` from `@decisionator/plugin-sdk`

## Capabilities & Constraints

1. **Real-time Live Sync**:
   - `watch(ref, onChange)` establishes `onSnapshot` listeners on `/projects/{id}`, `/projects/{id}/options`, and `/projects/{id}/entries`.
   - Fires `onChange(snapshot)` within <1s of remote database mutations.
2. **Append-Only Entries**:
   - `append(ref, entries)` writes new documents into `/projects/{id}/entries/{entryId}`.
   - It never updates or deletes existing entry records.
3. **Password Protection**:
   - WebCrypto PBKDF2 salt, iteration count, and verifier stored in project document.
   - Entry payloads and option descriptions are encrypted using AES-GCM prior to being saved to Firestore.
4. **Security Rules**:
   - Project metadata & options updates: owner only (`request.auth.uid == resource.data.ownerId`).
   - Entries: append allowed for authenticated/invited participants; update and delete operations disallowed (`allow update, delete: if false`).
