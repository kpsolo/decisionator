# Security audit — 2026-10-27

## Remediation status (2026-10-27)

All findings below are fixed on `fix/architecture-review-hardening`, with contract version bumps and changesets. Summary of what changed and what risk remains:

| Finding | Status | Fix | Residual risk |
|---|---|---|---|
| F1 host impersonation | Fixed | Host signs every SDP answer with its Schnorr key (topic, attempt ids, offer/answer hashes, ts, nonce); guest verifies against the link's `hostKey` before using it, so `hello` only reaches the real host. No trust-on-first-use; links without `hostKey` are refused ("link out of date"); cached sessions with a pinned key lose it. live-share 3.2.0 | Hosts still on old code are refused by updated guests until reloaded |
| F2 dependencies | Fixed | zod 4.6.7, dompurify 3.4.17, markdown-it 15.0.3, MCP SDK 1.32.2 + transitive; `firebase` removed (unused). `pnpm audit --prod`: 0 vulnerabilities; CI gate on high+ | — |
| F3 Sheets trust model | Mitigated | Conflicting duplicate ids drop all copies; payload/column `by` mismatch dropped; trust model documented (sheet-store 2.4.0) | Drive writers can still forge rows — architectural; use live sessions for untrusted participants |
| F4 encryption downgrade | Fixed | `protected=false` after protection was seen → `PROTECTION_DOWNGRADE`; salt/verifier/iterations pinned → `PROTECTION_TAMPERED`; no plaintext writes while a key is loaded (all stores) | — |
| F5 hardcoded token | Fixed | Literal removed; owner pastes node-printed token (memory + sessionStorage); owner-only `POST/DELETE /api/v1/grants`; CORS allowlist; bridge disabled without token. agentic-api 1.4.0 | Nothing yet launches the node and shows the token |
| F6 no AAD | Fixed | Codec `enc:v2:` binds record/field context (rows: tab + every preceding column); `enc:v1:` still readable | Existing v1 ciphertexts are not re-encrypted |
| F7 draw fairness | Fixed | Seed = SHA-256 over tag + recorded inputs; `runTally` refuses caller seeds; `verifyOutcomeSeed`; UI shows verifiable / legacy / "re-decided N times". strategy 1.2.0 | Draw is predictable before close; a voter can tune their own ballot (visible in history). Commit-reveal is future work |
| F8 live-share limits, relay leftovers | Fixed | Rate limit per participant across links; ≤3 links per participant; ≤16 pre-hello; `close()` publishes "ended" tombstone + NIP-09 deletion | — |
| F9 relay | Fixed | 128-bit ids; invites bound to an out-of-band secret hash; signed WS subscribe + ACL + caps; rate limits; signature covers query + nonce with replay cache. relay-protocol 2.0.0 | Pending invites from before must be re-created; no client yet uses invites/live WS |
| F10 / F11 KDF, password length | Fixed | Iterations bounded [100k, 5M]; ≥12-char passwords in all stores | — |
| F12 plugin permissions | Fixed | Deny-by-default consent keyed by plugin id+version+permission set; `net:` must be exact https origin; install dialog starts unticked and only requested, well-formed permissions are stored; plugin-runtime 1.2.0 | Consent is a `window.confirm` until US6 adds a proper dialog |
| F13 firestore mock | Fixed | Manifest marked experimental/in-memory, net permissions dropped, README lists required `firestore.rules` | Real backend still needs rules |
| F14 agent target ids | Fixed | Unknown option/idea → 404 (REST) / error (MCP) | — |
| F15 misc | Fixed | LRU nonce cache; chunk index/count checks; linear fence scanner + 1 MB cap; xlsx inflate caps (25 MB/part, 50 MB total); exact store-id match; grant pruning + invalid-token throttle; MCP token only from header; srcdoc name escaped; Vite binds 127.0.0.1; share links from running origin; append without a known role refused | — |

---

Full-codebase audit (apps/web, packages/core, packages/plugin-sdk, packages/node, packages/relay, all plugins) plus `pnpm audit` of production dependencies. Findings were verified against source; file:line references are to the current `fix/architecture-review-hardening` branch.

## Executive summary

No token leakage, injection, or XSS was found — sanitization (markdown-it `html:false` + DOMPurify), Zod validation on everything read back from storage, `valueInputOption=RAW` for Sheets, and memory-only OAuth tokens are all solid. The real issues are **trust-model gaps**:

1. **(HIGH)** A live-share guest can impersonate the host during signaling and steal another guest's identity/votes.
2. **(HIGH)** Any Drive "writer" collaborator can forge authorship, outcomes and votes directly in the Google Sheet — all authorization is client-side.
3. **(CRITICAL dep)** DOMPurify has a published sanitizer-bypass advisory; it is the only thing between guest markdown and the DOM.

---

## Findings

### P0 — fix immediately

**F1. HIGH — Live share: host never authenticated on signaling; guest identity theft**
`plugins/share-inpage/src/rtc.ts:233` — `dialHost` accepts the first `answer` envelope; the only gate is the symmetric `signalKey` that *every* link holder shares. The guest then sends `hello` with its bearer `key` (`plugins/share-inpage/src/guest.ts:248`), and with no `hostKey` in the link it pins whatever host key the peer's `welcome` claims (`guest.ts:274`).
*Exploit:* malicious guest Bob answers Alice's offer faster than the host (e.g. during a host tab reload), receives Alice's `key`, reconnects to the real host as Alice, and votes/comments as her. The host Schnorr key already exists but only signs relay records.
*Fix:* sign the SDP `answer` envelope (and `welcome`) with the host Schnorr key; guest verifies against the link's `hostKey` **before** sending `hello`; make the `hostKey` link segment mandatory.

**F2. CRITICAL (dependency) — DOMPurify ≤3.4.16 sanitizer bypass + markdown-it <15.0.3 quadratic rendering + zod <4.6.6 memory exhaustion**
`pnpm audit`: dompurify (critical GHSA + high GHSA, `apps/web`), markdown-it (high, `apps/web` — guest-supplied comment bodies hit it), zod (high, `packages/core`), undici/@grpc/grpc-js (high, via firebase in store-firestore), body-parser/qs/ip-address (via MCP SDK in packages/node), fast-uri (apps/web). 37 advisories total: 1 critical, 10 high.
*Fix:* bump dompurify ≥3.4.17, markdown-it ≥15.0.3, zod per its patched range, firebase and @modelcontextprotocol/sdk to current; add `pnpm audit --prod` to CI.

**F3. HIGH — Sheets backend: all authorization/authorship is client-side; any writer forges anything**
`plugins/store-google-sheets/src/sheet-store.ts:582-599` (role checks), `src/rows.ts:68-75,136-152` (decoded `by` trusted unconditionally; payload `by` even overrides the column); first-wins id dedup (`sheet-store.ts:492-499`) lets an inserted row shadow a victim's entry.
*Exploit:* a "contribute" collaborator opens the sheet in the Sheets UI and appends a grade `by = owner@…`, fabricates an `outcomes` row, or edits others' ballots.
*Fix (layered, architectural):* (a) document the trust model in `contracts/sheet-store.md` and surface "contributor data is not tamper-proof against collaborators" in the sharing UI; (b) make dedup last-write-wins or flag duplicate ids; (c) longer term, consider per-participant HMAC author stamps or move multi-writer flows to live share, where the host mediates.

### P1 — fix this iteration

**F4. MEDIUM — Protected-project encryption downgrade via writable `meta!protected` flag**
`plugins/store-google-sheets/src/sheet-store.ts:387-388,606-614,1081-1106` — a writer without the password flips `protected` to false; the next key-holder write goes out as plaintext. Same writer can tamper `salt`/`verifier`/`kdfIterations` (lockout / CPU DoS).
*Fix:* once a project is known-protected in session, never downgrade based on the sheet; refuse plaintext writes when a key is loaded; clamp `kdfIterations` (see F10).

**F5. MEDIUM — Hardcoded public bearer token wired to owner-only bridge routes**
`apps/web/src/app/ProjectViewPage.tsx:549`, `apps/web/src/features/live/LiveSessionDialog.tsx:204,222,262,290` — `deci_agent_token_local` is compiled into the public SPA and sent to owner-only node routes. The server currently rejects it (so the bridge is dead wiring), but the obvious "make it work" fix — setting it as `DECISIONATOR_OWNER_TOKEN` — would hand owner powers to any local process.
*Fix:* delete the constant; pass the real `ownerToken` from `startNodeServer` output into the owner tab; build an actual grant-provisioning flow for agents (no route mints grants today).

**F6. MEDIUM — Password codec lacks AAD: ciphertext swap/replay within a project**
`packages/core/src/crypto/payload-codec.ts:76-93` — fields are AES-GCM-encrypted independently under one key with no context binding; a collaborator without the password can swap option A's sealed title with option B's and both decrypt cleanly.
*Fix:* pass `additionalData` (projectId + entryId + field) to `subtle.encrypt/decrypt`; needs a codec version bump + migration for existing sealed data.

**F7. MEDIUM — Random-draw outcomes are owner-forgeable (chosen seed)**
`packages/core/src/strategy-host/tally.ts:42,75` — `runTally` accepts any caller seed and records it; replayability proves determinism, not fairness. Owner can grind seeds / re-adopt until the preferred option wins.
*Fix:* minimum — document the trust statement; better — commit-reveal (publish hash of seed before closing) or derive the seed from all ballots + a pre-committed nonce.

**F8. MEDIUM — Live share: per-link (not per-participant) rate limit; snapshot persists on public relays after session end**
`plugins/share-inpage/src/host.ts:141,337-347` — one guest can open up to 64 channels for ~320 writes/s and fill all slots. `host.ts:397-418` + `session.ts:193-199` — closing a session publishes no tombstone/NIP-09 deletion, so the last redacted snapshot stays decryptable on public relays indefinitely.
*Fix:* key rate limit and connection cap per participant key; publish an "ended" tombstone + deletion on `close()`.

**F9. MEDIUM — packages/relay: Math.random invite/tunnel ids; invite hijack; unauthenticated live WS**
`packages/relay/src/app.ts:389,395-425`, `src/server.ts:33-61,96` — ~26–31-bit guessable ids, any keyholder can accept a pending invite (owner then seals the project key to the hijacker), no rate limiting, live WebSocket needs no signature.
*Fix:* `crypto.randomBytes(16)` ids; bind invite accept to an out-of-band invitee key; ACL-gate the live WS; add route rate limits. Also (LOW) add a replay nonce to signed requests and include the query string in the signature (`packages/core/src/crypto/relay-crypto.ts:133-160`).

### P2 — hardening backlog

**F10. LOW — KDF iterations read from untrusted doc, unbounded** — `store-file/src/file-store.ts:727`, `store-local/src/store.ts:728`, `store-google-sheets/src/sheet-store.ts:398`. Clamp to [100k, 5M].
**F11. LOW — Minimum password length only enforced in one path** — `sheet-store.ts:974` requires 12 chars but `createProject` and the file/local/firestore stores accept 1 char. Enforce ≥12 everywhere (shared validator in core).
**F12. MEDIUM (forward-looking) — Plugin manifests self-grant permissions incl. network egress** — `apps/web/src/host/module-host.ts:290,349`, `host/sandbox/csp.ts:8-12` (`net:*` → `connect-src *`). Must add a user-consent/allowlist step before US6 third-party plugins ship. Related LOW: srcdoc CSP template injection via manifest name (`host/sandbox/frame-manager.ts:35-36`) — URL-parse `net:` origins, escape the title.
**F13. MEDIUM (forward-looking) — store-firestore is a mock advertising security it doesn't have** — `plugins/store-firestore/src/firestore-store.ts:109-132`; no network calls, no `firestore.rules` in repo. Either label it experimental/in-memory or ship real rules with the backend.
**F14. LOW — Agent contributions accept non-existent target ids** — `packages/node/src/agent-api/rest.ts:363-369`, `mcp.ts:234-240`. Validate `targetId` against the project like `setSharedProperty` does.
**F15. LOW — misc** — signaling dedup set cleared wholesale (`share-inpage/src/signaling.ts:78` → LRU); chunk reassembly accepts negative index / zero count (`share-inpage/src/link.ts:107`); fenced-block regex quadratic on unclosed fences (`core/src/format/extract.ts:13` → cap input); no decompression cap on xlsx import (`core/src/export/xlsx.ts:185`); grants/pseudonyms never pruned (`node/src/agent-api/grants.ts`); MCP accepts token from request body (`mcp.ts:37-41`); stale cached role after revocation (`sheet-store.ts:573-581`); hardcoded share-link origin (`sheet-store.ts:928`, `share.ts:24`); Vite dev server on `0.0.0.0` (`apps/web/vite.config.ts`); live-session join secrets persist in browser history via the URL fragment.

---

## Fix plan

Proposed order of work (each phase = one branch/PR, conventional commits, contract tests first where a contract changes):

**Phase 1 — P0 (days):**
1. Dependency bumps + `pnpm audit` CI gate (F2) — mechanical, do first.
2. Host-authenticated signaling: Schnorr-sign `answer`/`welcome`, mandatory `hostKey` in links, guest verifies before `hello` (F1). Bump `live-share.md` contract + changeset.
3. Sheets trust-model documentation + last-write-wins dedup + UI warning (F3 mitigations).

**Phase 2 — P1 (this iteration):**
4. Encryption downgrade guard + KDF clamp + uniform ≥12-char passwords (F4, F10, F11).
5. Remove `deci_agent_token_local`; real owner-token plumbing + grant provisioning route (F5).
6. AAD in payload codec with codec v2 + migration (F6). Contract + changeset.
7. Seed commit-reveal or documented trust statement for random strategies (F7).
8. Live-share per-participant limits + end-of-session tombstone (F8). Contract 3.2.0.
9. Relay: crypto-random ids, invite binding, WS auth, rate limits, request nonce (F9).

**Phase 3 — P2 backlog:** F12–F15 as individual small fixes; F12/F13 are blockers for US6 (plugin sandbox) and the real Firestore backend respectively — track them in those specs.
