# @decisionator/store-firestore — EXPERIMENTAL, in-memory only

> **Warning:** this package is a mock. `FirestoreProjectStore` keeps every project in memory in
> the current tab. It makes no network calls, does not talk to Firebase, and has **no
> server-side security**: roles, authorship (`by`) and owner-only rules are checked only in this
> client. Data is lost when the tab is closed. Do not use it for real decisions.

What it does model faithfully:

- the `ProjectStore` contract (it passes the shared contract test kit);
- client-side encryption of password-protected projects (PBKDF2-SHA-256 + AES-256-GCM, codec
  `enc:v2:` with the value's place bound as additional data).

## Before a real Firestore backend ships

A real backend **must** ship a `firestore.rules` file, reviewed and tested with the emulator,
that enforces on the server what this mock only checks in the client:

- only signed-in users listed as collaborators can read a project; only `contribute`/`owner`
  can create entries, and only the owner can change meta, options, sharing, or write outcomes;
- every entry's `by` equals `request.auth.token.email` (or uid) — no forged authorship;
  delegated entries (`onBehalfOf`) only from the owner;
- entries are append-only (no update/delete), ids unique;
- protection fields (`protected`, `salt`, `iterations`, `verifier`) are owner-writable only and
  cannot be switched off without re-encrypting the data.

It must also declare its network origins (e.g. `net:https://firestore.googleapis.com`) in
`decisionator-plugin.json`; this mock declares none because it uses none.
