# Phase 0 Research: Decision Engine Core (MVP)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-05

Each entry: **Decision** / **Rationale** / **Alternatives considered**. Items marked
⚠ *spec impact* change or refine a spec requirement and are reflected in `spec.md`.

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

- **Decision**: A **local node** — one Node.js process per user (`npx deciginator` /
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
  iframe per plugin** served by the node from `/_plugin/<id>/<version>/frame` with HTTP headers
  `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src <node-origin>;
  connect-src <hosts declared in manifest>`. The frame has an opaque origin (no access to node
  cookies/storage/API). The host talks to the plugin over a typed `postMessage` RPC
  (see [contracts/plugin-runtime.md](./contracts/plugin-runtime.md)). Every call has a timeout
  (default 5 s, strategies 2 s); a frame that errors or hangs is torn down and reported.
- **Rationale**: The browser's sandbox + CSP gives *enforced* network allow-listing and failure
  isolation (constitution: permission model, failure isolation) with zero native dependencies.
  The node process runs no third-party code at all, so the agentic API and stored data are never
  exposed to plugins. Built-ins use the identical mechanism (Principle I).
- **Alternatives**: Node permission model in child processes (`--allow-net` is experimental and
  2026 CVEs (CVE-2026-21636, CVE-2026-21711) show UDS bypasses — not a security boundary we can
  promise); `isolated-vm` / QuickJS-WASM in the node (heavy, native or slow, and still needs a
  hand-built network proxy); trusting plugins (violates the constitution).
- **Consequence**: plugins only run while the UI is open. Acceptable: in v1 every plugin action
  (import, decide, verify, tally) is user-initiated in the UI, and agents may not trigger
  outcomes (FR-022).

## R5. Plugin packaging and distribution

- **Decision**: A plugin package is a directory or `.zip` containing `deciginator-plugin.json`
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
  - **Invite** = link `deciginator://join?relay=…&doc=…#k=<sealed invite>`; the decision key is
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
     Hono adapter), Streamable HTTP at `/mcp`, plus `deciginator mcp` stdio bridge for clients
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
  via `DECIGINATOR_GOOGLE_CLIENT_ID`.
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
  `Title: description` splits into title/description. Preview cap 500 items, adjustable.
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
- **Contract test kits**: `@deciginator/plugin-sdk/testing` exports `runStrategyContractTests`,
  `runIdeaSourceContractTests` — the same suites run against built-in plugins in CI and by
  third-party authors locally (Principle VII).
- **Alternatives**: Turborepo/Nx (unnecessary at this size; can add later); ESLint + Prettier
  (two tools vs one).

## R16. Export format

- **Decision**: `.deciginator.zip` containing `manifest.json` (format version, exported-at,
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

- [Automerge 3.0 announcement](https://automerge.org/blog/automerge-3/)
- [Automerge Repo 2.0](https://automerge.org/blog/automerge-repo-2/)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Google Picker — desktop apps](https://developers.google.com/workspace/drive/picker/guides/overview-desktop)
- [Google Docs API scopes](https://developers.google.com/docs/api/auth)
- [Node.js 25 permission model `--allow-net`](https://dev.to/mr_manushukla/nodejs-25-permission-model-scope-allow-net-and-allow-fs-for-production-2026-745)
- [CVE-2026-21636](https://v2.cvefeed.io/vuln/detail/CVE-2026-21636),
  [CVE-2026-21711](https://explore.alas.aws.amazon.com/CVE-2026-21711.html)
