# Phase 0 Research: Decision Engine Core

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-05
(revised the same day for the Google-based MVP)

Each entry: **Decision** / **Rationale** / **Alternatives considered**. Items marked
⚠ *spec impact* change or refine a spec requirement and are reflected in `spec.md`.

## Status after the MVP revision

The owner's first user story redefined the MVP: a hosted web app storing each project in a
Google Sheet. R18–R28 below are the MVP decisions. R1–R17 stay valid as follows:

| Decision | Status |
|----------|--------|
| R1 language, R11 RNG, R12 UI, R13 schemas, R15 tooling, R17 licenses | **MVP** (unchanged) |
| R10 clipboard | **MVP**, simplified: a paste box needs no clipboard permission (R24) |
| R16 export | **MVP**, format extended for grades and rankings |
| R2 local node, R14 localhost security | **US5 / US7** (agent API, local mode) |
| R3 Automerge | **US7** (local mode); the MVP stores rows in Google Sheets (R20) |
| R4 sandbox, R5 plugin packaging | **US6**; MVP built-ins use the same contracts in-process (R26) |
| R6 relay, R8 agent tunnel | **US7** and **US5** |
| R7 agent API | **US5** |
| R9 Google Docs source | **US6**; in the hosted app it uses the browser token and web Picker from R19 instead of the loopback broker |

---

## R18. MVP runtime: hosted static web app, no backend

- **Decision**: A static single-page app (React 19 + Vite) hosted on GitHub Pages at
  `https://kpsolo.github.io/decisionator/` and deployed by GitHub Actions. It calls Google APIs
  directly from the browser. The project runs no server of its own (SC-009).
- **Rationale**: A share link must open with one click for anyone (US2). A static host costs
  nothing, and keeps the project's attack surface and operations at zero. All data goes straight
  from the browser to the user's own Google Drive.
- **Alternatives**: Local node first (link recipients would need to install it; owner chose
  hosted); Cloudflare Pages or Netlify (equally fine; GitHub Pages keeps everything in one repo);
  a backend proxy for Google APIs (adds cost, a server and a data processor in the middle).

## R19. Google sign-in and scopes

- **Decision**: Google Identity Services **token model** in the browser, requesting only
  `https://www.googleapis.com/auth/drive.file`. Access tokens are held in memory, never stored.
  When a token expires (about 1 hour) the app requests a new one, silently if Google allows,
  otherwise with one click. The user's display name and email come from Drive `about.get`, so
  no extra profile scopes are needed.
- **Rationale**: `drive.file` is Google's recommended **non-sensitive** per-file scope: no app
  verification, and the app can only touch files it created or that the user opened with it
  (FR-008). Sheets API calls work on those files with this scope.
- **Alternatives**: `spreadsheets` scope (sensitive → verification, and access to all of the
  user's Sheets); `drive` scope (restricted → security assessment); refresh tokens (they need a
  backend to keep the client secret).

## R20. Project storage: one Google Sheet per project ⚠ *spec impact*

- **Decision**: A project is a Google Sheet in the owner's Drive. Drive `appProperties` tag it as
  `{decisionator: "project", formatVersion: "1"}`. Tabs: `meta`, `options`, `grades`, `comments`,
  `rankings`, `outcomes` (layout in [contracts/sheet-store.md](./contracts/sheet-store.md)).
  - **Append-only rows** for grades, comments, rankings and outcomes (`values.append`). The latest
    row per (participant, option) wins for grades, and the latest per participant wins for
    rankings. Nobody ever overwrites another person's row (FR-009).
  - `options` and `meta` are written only by the owner.
  - One `values.batchGet` reads all tabs in a single request.
  - "My projects" uses Drive `files.list` filtered by `appProperties`. With `drive.file`, it
    returns only the projects the app created or the user opened.
- **Rationale**: Appends are atomic per request, so concurrent collaborators don't conflict.
  Stats are simple aggregations. People can still open the Sheet in Google Sheets, which builds
  trust.
- **Spec impact**: none beyond the clarified choice. Tampering by people with edit rights in
  Google Sheets is an accepted MVP risk (spec Assumptions).
- **Alternatives**: Google Doc (owner considered it; structured concurrent data is awkward);
  JSON file in Drive (whole-file rewrites would conflict between collaborators).

## R21. Sharing by link and collaborator access ⚠ *spec impact*

- **Decision**:
  - "Share" calls Drive `permissions.create` with `{type: "anyone", role: "reader" | "writer",
    allowFileDiscovery: false}`: view = reader, contribute = writer. The Deci link is
    `https://kpsolo.github.io/decisionator/#/p/<fileId>`, and the file ID is not secret by
    itself.
  - A collaborator opening the link signs in, then confirms access in a Google Picker opened with
    `setFileIds([fileId])`. That grants the app `drive.file` access to that one file (one
    confirmation, FR-016).
  - **Invite by email** is also offered (`type: "user"`). It is the way to remove individual
    people later: Drive cannot exclude one person from an "anyone with the link" permission.
- **Spec impact**: FR-018 is refined. Turning off link sharing works for everyone at once;
  removing an individual requires invite-by-email mode, or rotating the project to a new copy.
  The UI explains this when the owner tries to remove someone from a link-shared project.
- **Risk / spike (Increment 0, T032 outcome)**:
  - Spike conclusion: Google Picker's `setFileIds([fileId])` works seamlessly when the file is already associated with the user's account. However, for an anonymous/fresh account receiving only a public link, Drive can reject direct picker opening before the file is added to "Shared with me".
  - **Adopted flow (US2 T065)**: The link join page provides a 2-step single-click flow:
    1. Primary: Opens Picker with `setFileIds([fileId])`.
    2. Automatic Fallback: If Picker reports access denied / not found, the UI prompts: *"Please click once to view this file in Google Sheets (which registers it in your Drive), then click Confirm"*.
    3. Direct email invites (`type: "user"`) remain supported for seamless instant access without Picker ambiguity.
  - This satisfies FR-016 with zero external server dependencies.

## R22. Password protection

- **Decision**: Optional per-project password.
  - The key is derived with PBKDF2-HMAC-SHA-256, 600 000 iterations (WebCrypto, OWASP guidance)
    and a random 16-byte salt.
  - Payload cells are encrypted with AES-256-GCM using a fresh 12-byte IV per cell.
  - `meta` holds the salt, the iteration count and an encrypted verifier string, plus nothing
    readable about the content. The Sheet is titled "Deci project (protected)".
  - The password never leaves the browser. The derived key is kept in memory for the session
    only.
- **Rationale**: Google sharing has no passwords, so real protection requires client-side
  encryption (FR-017, SC-007). Everything needed is built into browsers.
- **Limits stated in the UI**: a lost password cannot be recovered. The "5 tries, then wait"
  rule only slows casual guessing; an attacker who copies the Sheet can guess offline, so the
  UI asks for a passphrase of at least 12 characters.
- **Alternatives**: Argon2id (stronger, but needs a WASM dependency; it can replace PBKDF2 behind
  the `kdf` field in `meta` later); a password check only, without encryption (the Sheet would
  stay readable, which fails SC-007).

## R23. Live updates within free quotas

- **Quotas** (verified 2026-10-05):
  - Sheets API: 300 reads and 300 writes per minute per project, and 60 per minute per user. No
    daily limit.
  - Drive API: 1 000 000 quota units per minute per project, 400 M units per day free.
    `files.get` costs 5 units.
  - Google plans charges for usage beyond quota later in 2026.
- **Decision**:
  - While a project tab is visible, poll Drive `files.get?fields=version` every 10 s. This costs
    5 Drive units and no Sheets quota.
  - Only when `version` changes, do one Sheets `values.batchGet`, at most one every 15 s per
    client.
  - Writes go into a local queue, flushed at most every 2 s as one append per tab.
  - On `429`/`403 rateLimitExceeded`, use truncated exponential backoff with jitter (max 64 s)
    and show "syncing paused, retrying in N s". The queue persists in IndexedDB, so no input is
    lost (FR-020, SC-005).
  - Polling stops when the tab is hidden.
  - A client-side budget caps each client at 20 Sheets reads and 20 writes per minute, a third of
    the per-user quota.
- **Rationale**: Meets the 30 s freshness target (SC-004) while spending Sheets quota only on real
  changes. The project-wide 300 reads/min is the shared ceiling for all users of the hosted app,
  so self-hosters can configure their own Google client (R28). Quota increases can be requested
  free of charge if needed.
- **Alternatives**: Drive push notifications / `changes.watch` (needs a public webhook server);
  polling Sheets directly (burns the scarce quota).

## R24. Format instruction and JSON format

- **Decision**:
  - A versioned JSON format `decisionator.options/v1`, defined in
    [contracts/options-format.schema.json](./contracts/options-format.schema.json).
  - A plain-English **format instruction** template
    ([contracts/format-instruction.md](./contracts/format-instruction.md)). It embeds the user's
    pasted text and a compact example, and asks for JSON only.
  - Input is a paste box (no clipboard permission needed).
  - Extraction order: a fenced ```json block, then the first balanced `{…}` or `[…]`.
  - Validation uses the Zod schema, which is also exported as JSON Schema. Errors are reported
    per item and field, and a **correction instruction** quotes the errors back for the AI.
- **Rationale**: Works with any assistant, including the launch list (Claude, Gemini),
  with no integration. The same format later serves connected agents (US5).
- **Validation of SC-002**: a fixture set of real answers from each launch assistant for 5 sample
  lists, collected manually and replayed in CI. The v1.0 run (10/10 valid) led to template v1.1,
  and the v1.1 run (9/10 strict) to v1.2, which adds an explicit language hint detected with
  `franc-min` (MIT). See the contract changelog.

## R25. Ranked vote tally

- **Decision**: Truncated **Borda count**. On a top-N ballot, rank r earns N − r + 1 points, and
  unranked options earn 0. Ties are broken in order by higher average grade, then more first-place
  votes, then a seeded random draw. That seed is generated when voting closes and is recorded
  (R11 RNG). The tally is implemented as a strategy module against the strategy contract (with
  `ballots: "ranking"`), so it is deterministic and verifiable (FR-023, FR-024, SC-006).
- **Rationale**: Borda yields a full order (useful for a ranked shortlist), is easy to explain
  ("points per option"), and works with partial ballots.
- **Alternatives**: Instant-runoff (good for a single winner, but no meaningful full order; a
  later strategy plugin); Condorcet methods (harder to explain).

## R26. Plugin architecture in the MVP

- **Decision**: The MVP ships first-party modules only: the Google Sheets project store, the
  paste/format idea source and the Borda ranking strategy. Each implements the public contracts
  in `@decisionator/plugin-sdk` (project store, idea source, strategy) and is loaded in-process.
  Sandboxed loading of third-party plugins (R4) arrives with US6.
- **Rationale**: Keeps the MVP small while keeping Principle I honest. The contracts are the
  same, so moving built-ins into the sandbox later needs no changes to them. This is recorded in
  the plan's Complexity Tracking.

## R27. Offline drafting and resilience

- **Decision**: Drafts (pasted text, formatted preview) and the outgoing write queue are kept in
  IndexedDB. A service worker caches the app shell. Without network, users can paste, format,
  preview and queue grades and comments, which sync when they're back online.
- **Rationale**: Covers the constitution's offline-capable core as far as a Google-backed MVP
  allows. The remaining gap is recorded in Complexity Tracking.

## R28. Google Cloud configuration and self-hosting

- **Decision**: The project registers one Google Cloud project with:
  - an OAuth **Web** client whose authorized JavaScript origin is `https://kpsolo.github.io`;
  - an API key restricted to that referrer and to the Picker API;
  - the OAuth consent screen published "In production", with only the non-sensitive `drive.file`
    scope, so there is no verification and no 100-test-user cap.

  Builds read `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_BASE_URL`, so forks and
  self-hosters can use their own project and quota.
- **Rationale**: Works out of the box for users (the owner's requirement), while anyone can
  escape the shared quota ceiling.

---

## R1. Language and runtime

- **Decision**: TypeScript (strict) everywhere, ESM only. Node.js 24 LTS for the local node and
  relay; evergreen browsers (last 2 versions of Chromium, Firefox, Safari) for the UI.
- **Rationale**: One language across core, UI, plugin SDK, relay and plugins lowers the barrier
  for plugin authors (SC-004) and lets the domain core run unchanged in Node and the browser.
  Largest contributor pool for an OSS project with a web UI.
- **Alternatives**: Rust core + TS UI (faster, but two toolchains and a much smaller plugin-author
  audience); Go relay (fine, but splits the codebase for little gain at our scale).

## R2. Application shape for "local-first + agent-reachable"

- **Decision**: A **local node** — one Node.js process per user (`npx decisionator` /
  Docker image in v1) that owns storage, the agentic API (MCP + REST), the OAuth broker and the
  sync client, and serves the web UI at `http://127.0.0.1:4178`. A desktop installer that wraps
  the same node is a follow-up feature.
- **Rationale**: Agents need an endpoint to call; a browser-only PWA cannot accept inbound
  connections. A local process gives local agents (Claude Code, Claude Desktop, Cursor, etc.)
  a direct, fully private MCP endpoint, keeps data on the device (FR-027) and works offline.
  The same pattern is proven by Jupyter, Actual Budget and Ollama.
- **Alternatives**: Pure PWA + IndexedDB (no agent endpoint without a server); Electron/Tauri
  app first (adds packaging/signing work before the core is validated — deferred, not rejected);
  hosted SaaS (rejected in clarification Q1).

## R3. Data model storage and concurrency

- **Decision**: **Automerge 3** documents via **automerge-repo 2**: one document per decision
  plus one workspace document (idea pool, decision index). Node persists with the Node FS storage
  adapter; the UI syncs with the node over a localhost WebSocket adapter. Local-only state
  (identity keys, grant hashes, plugin registry/settings, relay config) lives in JSON files in
  the node's data directory, written atomically, permissions `0600`.
- **Rationale**: CRDTs satisfy FR-026 (no silent overwrite) by construction. Automerge changes
  are hash-chained, self-contained and immutable — a natural fit for append-only outcomes and
  attribution (Principle VI) and for log-based replication through an untrusted relay (R6).
  Automerge 3 cut memory use >10x and keeps the Automerge 2 file format.
- **Alternatives**: Yjs (faster, but weaker built-in history/attribution model; E2E sync would
  need a library such as secsync); SQLite + custom sync (we would reinvent conflict handling);
  `node:sqlite` for local state (still maturing; JSON files are enough for kilobytes of state).

## R4. Plugin runtime, isolation and permissions

- **Decision**: All third-party *and* built-in plugin code runs **in the UI, inside a sandboxed
  iframe per plugin**. In a node-hosted environment, it is served from `/_plugin/<id>/<version>/frame`
  with HTTP response headers. For **static hosting (GitHub Pages)**, GitHub Pages cannot set custom
  HTTP response headers. Therefore, the web app instantiates `<iframe sandbox="allow-scripts" srcdoc="...">`
  with an inline `<meta http-equiv="Content-Security-Policy">` synthesized dynamically from granted
  `net:` permissions:
  `default-src 'none'; script-src 'unsafe-inline' blob:; connect-src <granted origins>; style-src 'unsafe-inline'`.
  The frame has an opaque origin (no access to parent cookies/storage/API). The host talks to the
  plugin over a typed `postMessage` RPC (see [contracts/plugin-runtime.md](./contracts/plugin-runtime.md)).
  Every call has a timeout (default 5 s, strategies 2 s); a frame that errors or hangs is torn down and
  reported (FR-052).
- **Rationale**: The browser's sandbox + CSP gives *enforced* network allow-listing and failure
  isolation (constitution: permission model, failure isolation) with zero native dependencies.
  The static hosting adaptation using `srcdoc` and `<meta http-equiv="Content-Security-Policy">`
  maintains identical security properties on static zero-server hosting (SC-009). Built-ins use the
  identical mechanism (Principle I).
- **Alternatives**: Node permission model in child processes (`--allow-net` is experimental and
  2026 CVEs (CVE-2026-21636, CVE-2026-21711) show UDS bypasses — not a security boundary we can
  promise); `isolated-vm` / QuickJS-WASM in the node (heavy, native or slow, and still needs a
  hand-built network proxy); trusting plugins (violates the constitution).
- **Consequence**: plugins only run while the UI is open. Acceptable: in v1 every plugin action
  (import, decide, verify, tally) is user-initiated in the UI, and agents may not trigger
  outcomes (FR-022).

## R5. Plugin packaging and distribution

- **Decision**: A plugin package is a directory or `.zip` containing `decisionator-plugin.json`
  (manifest, [contracts/plugin-manifest.schema.json](./contracts/plugin-manifest.schema.json)),
  one ESM bundle and optional assets. Installed from a local file or an HTTPS URL to a `.zip`
  (FR-034). The node stores packages content-addressed by SHA-256; the hash is recorded in
  outcomes so verification uses the exact code that decided.
- **Rationale**: Simple, language-agnostic manifest; content hashing makes "same strategy
  version" provable (Principle VI); no registry to operate in v1.
- **Alternatives**: npm packages as plugins (needs a resolver and pulls arbitrary dependency
  trees at install time); in-app catalog (out of scope per Q3).

## R6. Sharing, identity and the relay (end-to-end)

- **Decision**:
  - **Identity**: each node generates an Ed25519 signing key and an X25519 encryption key
    (`@noble/curves`). Participants are identified by public key + display name (FR-027b).
  - **Per-decision key**: a random 256-bit symmetric key; content is encrypted with
    XChaCha20-Poly1305 (`@noble/ciphers`).
  - **Relay** = append-only log store of *encrypted, signed* Automerge change batches per shared
    decision, plus an owner-signed ACL (public keys + roles). The relay verifies signatures,
    rejects writes from non-writers and reads from non-members, and never holds keys.
  - **Invite** = link `decisionator://join?relay=…&doc=…#k=<sealed invite>`; the decision key is
    delivered sealed to the invitee's X25519 key after they present their public key (two-step
    invite) — keys never travel in a URL query string.
  - **Revocation**: owner removes the member from the ACL (relay stops serving them immediately)
    and rotates the decision key for future changes. Already-synced data cannot be recalled —
    stated in UI.
  - **Honest-client enforcement**: clients drop changes whose signer lacks the needed role in the
    ACL, so a view-only member cannot inject content even via a malicious relay.
- **Rationale**: Meets FR-027a (relay cannot read stored content) with small, audited pure-JS
  crypto libraries and a relay simple enough to self-host on any small VPS (one process, one
  SQLite file). Log-of-changes replication matches Automerge's change model (R3).
- **Alternatives**: automerge-repo sync server (requires the server to read documents);
  Keyhive/Beehive (promising, not production-ready); MLS group key agreement (overkill for
  ≤20 participants).

## R7. Agentic API surface

- **Decision**: Two transports over **one command layer** in the node:
  1. **MCP** (primary for agents), MCP TypeScript SDK v2 (`@modelcontextprotocol/server` with the
     Hono adapter), Streamable HTTP at `/mcp`, plus `decisionator mcp` stdio bridge for clients
     that only speak stdio. Spec revision 2026-07-28.
  2. **REST** `/api/v1` with an OpenAPI 3.1 document at `/api/v1/openapi.json`, generated from
     the same Zod schemas.
  Both are self-describing (MCP tool list, OpenAPI) — FR-017. Tool/operation list:
  [contracts/agentic-api.md](./contracts/agentic-api.md).
- **Rationale**: MCP is what most "own agents" already speak; REST covers everything else
  (scripts, custom GPT actions, n8n). Generating both from one schema keeps parity (Principle IV).
- **Alternatives**: REST only (agents need glue code); GraphQL (heavier, less agent-native);
  MCP SDK v1.x (superseded by the stable v2 line).

## R8. Agent requests, grants and remote agents ⚠ *spec impact*

- **Decision**:
  - An **agent request** creates a **grant**: random 256-bit bearer token (shown once, stored as
    SHA-256 hash), scope = target + permissions, default expiry 24 h (FR-020), revocable.
  - The UI produces a copyable **agent brief**: the instruction, the MCP URL, the REST base +
    OpenAPI URL, the token, and the rules (attribution, no outcomes). Local agents use
    `http://127.0.0.1:4178/mcp`.
  - **Remote agents** (cloud assistants that cannot reach localhost) use an **agent tunnel**
    through the relay: the node holds an outbound WebSocket to the relay while it has open remote
    requests; the relay exposes `https://<relay>/t/<tunnel-id>/mcp` and forwards requests to the
    node, where grant checks happen. The issuing node must be online while the agent works.
  - Limits: contribution ≤ 64 KB markdown, ≤ 20 sources, ≤ 50 contributions per request,
    ≤ 60 requests/minute per grant.
- **Spec impact**: TLS terminates at the relay, so the relay operator *can* see agent tunnel
  traffic in transit (only the scoped context the user chose to give their agent). FR-027a is
  refined: stored/relayed decision content stays end-to-end encrypted; agent tunnel traffic is
  disclosed in the UI as visible to the relay operator, and local agents/self-hosted relays avoid
  this entirely.
- **Rationale**: Keeps keys and permission enforcement in exactly one place (the user's node).
- **Alternatives**: Relay-side "agent gateway" holding a decryption key in the token (works while
  the node is offline, but puts key material on the relay and duplicates permission logic);
  end-to-end TLS passthrough tunnels (operationally complex for self-hosters).

## R9. Google Docs idea source and OAuth

- **Decision**: The node offers a **generic OAuth 2.0 broker capability** to plugins (permission
  `oauth:<provider-id>` with endpoints/scopes/extra params declared in the manifest). It runs the
  authorization-code + PKCE flow with a loopback redirect `http://127.0.0.1:4178/oauth/callback`,
  exchanges the code, and returns `{accessToken, expiresAt, callbackParams}` to the plugin.
  The Google Docs plugin uses Google's **desktop Picker flow**: scope `drive.file`, extra auth
  params `trigger_onepick=true&prompt=consent`; the callback carries `picked_file_ids`; the
  plugin then calls `docs.googleapis.com` `documents.get` per file (host allow-listed in its
  manifest). Tokens are kept **in node memory only** (no refresh tokens persisted in v1).
  The project ships a default Google "Desktop app" OAuth client ID; self-hosters can override it
  via `DECISIONATOR_GOOGLE_CLIENT_ID`.
- **Rationale**: `drive.file` is Google's recommended **non-sensitive** per-file scope — no app
  verification, user explicitly chooses documents (US3 #2), read limited to picked files. A
  generic broker avoids any Google-specific code in the core (Principle I) and serves future
  plugins (Notion, Dropbox…). Memory-only tokens mean no credentials at rest (Principle V).
- **Alternatives**: `documents.readonly` (sensitive scope → verification, 100-user cap for
  unverified apps); browser Google Identity Services + web Picker (needs a registered web origin;
  the plugin frame has an opaque origin); persisting refresh tokens (deferred until an OS
  keychain integration is added).
- **Parsing**: list items → one idea each; if the doc has no lists, each `HEADING_*` paragraph
  starts an idea whose description is the following body text. Identity for de-duplication:
  `(documentId, normalized text hash)` (FR-014).

## R10. Clipboard idea source

- **Decision**: The host reads clipboard text (`navigator.clipboard.readText()` on the user's
  click, permission `clipboard:read`) and passes the string to the plugin's `parse` call; the
  plugin never touches the clipboard API directly. Parsing: split lines, strip bullets
  (`-`, `*`, `•`, `1.`, `1)`, `[ ]`), trim, drop empties; `Title — description` or
  `Title: description` splits into title/description. Preview cap 500 items (the format's maximum); the user can lower it.
- **Rationale**: Clipboard access requires a user gesture in the top-level document; mediation
  keeps the permission model enforceable.

## R11. Reproducible randomness

- **Decision**: Seed = 128 random bits (hex). PRNG = **SHA-256 in counter mode**: block *i* =
  `SHA-256(seed ‖ uint32be(i))`; integers in `[0, n)` via rejection sampling on 32-bit words;
  floats via 53-bit construction. Specified in
  [contracts/strategy.md](./contracts/strategy.md) so any language can verify. Plugin frames
  replace `Math.random` and `crypto.getRandomValues` with throwing stubs for strategies.
- **Rationale**: Deterministic, trivially portable, uses an algorithm already available
  everywhere (`@noble/hashes`). FR-009, SC-003, Principle VI.
- **Alternatives**: Mulberry32/xoshiro (fine statistically but more room for cross-language
  implementation mistakes); seeded `Math.random` polyfills (not portable).

## R12. UI stack and accessibility

- **Decision**: React 19 + Vite, React Router, Radix UI primitives with our own minimal styling
  (CSS variables, light/dark), `@automerge/react` hooks for live documents, `@rjsf/core` with a
  custom Radix theme for schema-generated plugin settings (FR-030), Markdown (CommonMark via
  `markdown-it`, sanitized with DOMPurify) for descriptions and contributions.
- **Rationale**: React has the largest contributor pool; Radix gives accessible primitives
  (WCAG 2.1 AA, FR-037); rjsf turns the manifest JSON Schema into forms without custom code.
- **Alternatives**: Svelte/Solid (smaller ecosystems); Web Components (weaker form/a11y tooling);
  rich-text editors (Markdown is portable and diff-friendly for export).

## R13. Schemas and validation

- **Decision**: Zod 4 as the source of truth for domain/API schemas; JSON Schema (draft 2020-12)
  emitted via `z.toJSONSchema()` for contracts and OpenAPI. Plugin settings schemas are authored
  directly as JSON Schema in manifests and validated with Ajv.
- **Rationale**: One definition drives TS types, runtime validation, OpenAPI and MCP tool input
  schemas (Principle II: machine-readable contracts).

## R14. HTTP server and local security

- **Decision**: Hono on `@hono/node-server`. Node binds `127.0.0.1` only; rejects requests whose
  `Host` is not `127.0.0.1:<port>`/`localhost:<port>` (DNS-rebinding defense); UI session uses a
  random token delivered in the launch URL (Jupyter-style) and then an `HttpOnly; SameSite=Strict`
  cookie; agent endpoints accept only grant bearer tokens; CORS disabled except MCP per spec.
- **Rationale**: A localhost API is otherwise reachable by any web page or local process.

## R15. Monorepo, tooling, testing

- **Decision**: pnpm 10 workspaces (no extra orchestrator), Biome 2 (lint + format), Vitest
  (unit, integration, contract), Playwright (E2E + `@axe-core/playwright` accessibility checks),
  Changesets for versioning and changelogs, GitHub Actions CI (lint, typecheck, test, e2e on
  Linux/Windows/macOS).
- **Contract test kits**: `@decisionator/plugin-sdk/testing` exports `runStrategyContractTests`,
  `runIdeaSourceContractTests` — the same suites run against built-in plugins in CI and by
  third-party authors locally (Principle VII).
- **Alternatives**: Turborepo/Nx (unnecessary at this size; can add later); ESLint + Prettier
  (two tools vs one).

## R16. Export format

- **Decision**: `.decisionator.zip` containing `manifest.json` (format version, exported-at,
  exporter), `decisions/<id>.json` (plain JSON per [data-model.md](./data-model.md)),
  `decisions/<id>.automerge` (full history), `ideas.json`. Never includes keys, tokens or
  grants (FR-035, FR-036). JSON Schema published in `contracts/export.schema.json` (generated
  during implementation from Zod).

## R17. Licenses

All selected dependencies are MIT, Apache-2.0, ISC or BSD (Automerge MIT, noble MIT, Hono MIT,
React MIT, Radix MIT, rjsf Apache-2.0, MCP SDK MIT/Apache-2.0, Zod MIT, Ajv MIT) — compatible
with the project's MIT license.

---

## Sources

- [Google Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits)
- [Google Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits)
- [Picker `setFileIds` announcement](https://workspaceupdates.googleblog.com/2024/11/new-file-picker-method-for-pre-selecting-google-drive-files.html)
- [Automerge 3.0 announcement](https://automerge.org/blog/automerge-3/)
- [Automerge Repo 2.0](https://automerge.org/blog/automerge-repo-2/)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Google Picker — desktop apps](https://developers.google.com/workspace/drive/picker/guides/overview-desktop)
- [Google Docs API scopes](https://developers.google.com/docs/api/auth)
- [Node.js 25 permission model `--allow-net`](https://dev.to/mr_manushukla/nodejs-25-permission-model-scope-allow-net-and-allow-fs-for-production-2026-745)
- [CVE-2026-21636](https://v2.cvefeed.io/vuln/detail/CVE-2026-21636),
  [CVE-2026-21711](https://explore.alas.aws.amazon.com/CVE-2026-21711.html)
