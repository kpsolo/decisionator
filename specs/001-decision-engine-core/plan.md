# Implementation Plan: Decision Engine Core (MVP)

**Branch**: `001-decision-engine-core` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-decision-engine-core/spec.md`

## Summary

Deciginator v1 is a **local-first decision engine** with these parts:

- **Local node.** Each user runs a TypeScript/Node.js 24 process, started with
  `npx deciginator` or Docker. It owns the data (Automerge 3 CRDT documents on disk) and serves
  a React web UI on `127.0.0.1:4178`.
- **Agentic API.** The node exposes MCP (SDK v2, spec 2026-07-28) and REST/OpenAPI, built on a
  single command layer.
- **Plugins.** Every capability beyond the core is a plugin: strategies (manual, random,
  weighted, plurality vote) and idea sources (clipboard, Google Docs). Plugins run in sandboxed
  iframes with CSP-enforced permissions. Built-ins use exactly the same contract as third-party
  plugins.
- **Sharing.** An optional, self-hostable **relay** stores only signed, end-to-end encrypted
  change logs. It also provides an agent tunnel for cloud agents that cannot reach localhost.
- **Reproducible outcomes.** Every outcome records its strategy and package hash, the input
  snapshot and the seed. Randomness comes from a normative SHA-256 counter-mode RNG, so anyone
  can verify an outcome.

Delivery is incremental by user story. **US1 alone is the MVP.** US2–US6 each add one
independently demonstrable capability.

## Technical Context

**Language/Version**: TypeScript (strict, ESM). Node.js 24 LTS for the node and the relay.
Evergreen browsers for the UI.

**Primary Dependencies**:
- Data and sync: Automerge 3, automerge-repo 2 (`@automerge/react`)
- Server and agentic API: Hono 4 (`@hono/node-server`), MCP TypeScript SDK v2
  (`@modelcontextprotocol/server`, `@modelcontextprotocol/hono`)
- Schemas: Zod 4, Ajv
- UI: React 19, Vite, React Router, Radix UI, `@rjsf/core`, markdown-it, DOMPurify
- Crypto: `@noble/curves`, `@noble/ciphers`, `@noble/hashes`
- Relay storage: `better-sqlite3`

**Storage**:
- Automerge documents in the node data dir: one workspace doc plus one doc per decision.
- Local secret state in JSON files, `0600`.
- Content-addressed plugin store.
- Relay: a single SQLite file holding encrypted change logs.

**Testing**: Vitest (unit, integration, contract), the plugin-sdk contract test kits, and
Playwright with `@axe-core/playwright` for E2E and accessibility. CI runs on Linux, Windows and
macOS.

**Target Platform**: The local node runs on Windows, macOS and Linux (Node 24, or Docker). The
relay runs on any Linux host or Docker. The UI targets the last 2 versions of Chromium, Firefox
and Safari, and must stay usable down to 360 px wide.

**Project Type**: A local-first web application in a pnpm monorepo: core library, local node
server, SPA, self-hostable relay, plugin SDK and first-party plugins.

**Performance Goals**:
- First interactive UI in ≤ 2 s on localhost.
- Option add and edit reflected in ≤ 100 ms.
- Strategy run ≤ 2 s; timeout enforced.
- 50-item import ≤ 10 s (SC-005).
- Shared changes visible to collaborators ≤ 3 s online.

**Constraints**:
- Offline-capable core.
- No third-party code in the node process.
- No credentials at rest (OAuth tokens kept in memory only).
- The relay never holds keys.
- WCAG 2.1 AA.
- Node binds only to `127.0.0.1`, with Host/Origin checks.

**Scale/Scope**:
- 1 user per node, ≤ 20 participants per shared decision (spec assumption), relay limit 50.
- ≤ 1 000 decisions and ≤ 10 000 ideas per workspace.
- About 12 primary screens.

All Technical Context unknowns were resolved in [research.md](./research.md) (R1–R17). No
NEEDS CLARIFICATION remains.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle / Constraint | How the plan complies | Pre-research | Post-design |
|---|------------------------|-----------------------|:---:|:---:|
| I | Minimal core, everything is a module | `core` holds only the domain model, commands and crypto. Every strategy and idea source, including manual pick, is a plugin in `plugins/`, loaded through the public runtime. The OAuth broker is a generic capability with no Google code in the core (R9). | ✅ | ✅ |
| II | Stable, versioned contracts | Manifest JSON Schema with `platform.*` semver ranges; versioned runtime, strategy, idea-source, agentic API and relay contracts in [contracts/](./contracts/). The host refuses incompatible plugins. | ✅ | ✅ |
| III | Simple by default, deep on demand | The primary flow (new decision → options → Decide → outcome) needs no settings. Plugin settings are generated from JSON Schema behind a Plugins area. UI slots are confined. | ✅ | ✅ |
| IV | Agent-native | MCP and REST/OpenAPI come from one command layer, with a parity test. Grants are scoped, expiring and revocable. Agent contributions start `pending` and carry `ActorRef` attribution. Agents have no outcome, ballot, delete or share operations. A brief works with any vendor. | ✅ | ✅ |
| V | User owns the data | Local-first storage. The relay stores only ciphertext. OAuth tokens are memory-only. Export to an open zip/JSON format. Least-privilege `drive.file` scope. Agent tunnel transit visibility is disclosed (spec FR-027a, R8). | ✅ | ✅ |
| VI | Transparent, reproducible decisions | Outcomes are append-only and record strategy id, version and packageHash, the input snapshot, the seed and the trigger. The RNG algorithm is normative and has frozen test vectors. Viewers can verify. | ✅ | ✅ |
| VII | Test-first for contracts and strategies | Contract test kits in `plugin-sdk/testing`, agentic API contract tests for both transports, and seeded strategy tests. tasks.md will order these tests before implementation. | ✅ | ✅ |
| C1 | Bundled stores: clipboard + Google Docs; Obsidian external | `plugins/source-clipboard` and `plugins/source-google-docs` are bundled. Idea-source contract plus `examples/plugin-source-example` prove that external sources need no core change. | ✅ | ✅ |
| C2 | Permission model, network limited to declared hosts | Sandboxed iframe with CSP `connect-src` built from granted `net:` permissions. Host capabilities are permission-checked. | ✅ | ✅ |
| C3 | Failure isolation | One frame per plugin, RPC timeouts, teardown and an attributed error. A hanging-plugin E2E test. | ✅ | ✅ |
| C4 | Offline-capable core | Create, edit, manual, random and weighted decisions need no network. The relay is optional. | ✅ | ✅ |
| C5 | Permissive dependencies | All MIT, Apache-2.0, ISC or BSD (R17). | ✅ | ✅ |
| C6 | WCAG 2.1 AA | Radix primitives plus axe checks in E2E. | ✅ | ✅ |
| W | Workflow gates | Spec Kit flow followed. Conventional Commits. CI gates lint, typecheck, test, contract and e2e. Contract changes require a changeset. | ✅ | ✅ |

**Result**: PASS. There are no violations. Complexity Tracking below records structural choices
that a reviewer might question.

## Project Structure

### Documentation (this feature)

```text
specs/001-decision-engine-core/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R17
├── data-model.md        # Phase 1: entities, state machines, validation
├── quickstart.md        # Phase 1: validation scenarios per user story
├── contracts/
│   ├── plugin-manifest.schema.json
│   ├── plugin-runtime.md
│   ├── strategy.md
│   ├── idea-source.md
│   ├── agentic-api.md
│   └── relay-protocol.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
package.json                 # pnpm workspace root: scripts lint/typecheck/test/test:contract/test:e2e
pnpm-workspace.yaml
biome.json
tsconfig.base.json
.changeset/
.github/workflows/ci.yml

packages/
├── core/                    # @deciginator/core — isomorphic, no I/O
│   ├── src/model/           # Zod schemas: Decision, Option, Idea, Contribution, Ballot, Outcome…
│   ├── src/commands/        # validated mutations on Automerge docs + authorization (owner/contribute/view/agent)
│   ├── src/strategy-host/   # outcome recording, Rng (normative), verification
│   ├── src/crypto/          # identity, signing, envelope encryption, sealed boxes
│   ├── src/export/          # export/import format
│   └── test/                # unit/
├── plugin-sdk/              # @deciginator/plugin-sdk — what plugin authors depend on
│   ├── src/                 # definePlugin, types for strategy/idea-source/ui-slot, RPC client, ctx
│   ├── schema/              # plugin-manifest.schema.json (published copy of the contract)
│   └── testing/             # runStrategyContractTests, runIdeaSourceContractTests, vectors.json
├── node/                    # @deciginator/node — the local node + `deciginator` CLI
│   ├── src/server/          # Hono app, localhost security, UI static serving, plugin frame serving
│   ├── src/repo/            # automerge-repo setup, FS storage, WS adapter for the UI
│   ├── src/agent-api/       # grants, command bindings, MCP server, REST + OpenAPI
│   ├── src/oauth/           # generic OAuth2 + PKCE broker (loopback redirect)
│   ├── src/plugins/         # install (file/URL), content-addressed store, registry, settings
│   ├── src/sync/            # relay client: encrypted change log push/pull, invites, tunnel
│   ├── src/cli/             # start, mcp (stdio bridge), test-agent
│   └── test/                # integration/, contract/agentic-api.*
├── ui/                      # @deciginator/ui — React SPA
│   ├── src/app/             # routes: decisions, decision detail, ideas, plugins, settings
│   ├── src/components/      # accessible primitives (Radix-based)
│   ├── src/plugin-host/     # iframe sandbox manager, RPC, capability bridge, slots, rjsf settings
│   └── test/                # component + plugin-host tests
└── relay/                   # @deciginator/relay — self-hostable relay
    ├── src/                 # Hono app, signed-request auth, ACL, change log, invites, tunnels
    ├── compose.yaml, Dockerfile
    └── test/

plugins/                     # first-party plugins: same packaging as third-party (Principle I)
├── strategy-manual/
├── strategy-random/
├── strategy-weighted/
├── strategy-plurality/
├── source-clipboard/
└── source-google-docs/      # each: deciginator-plugin.json, src/, test/contract.test.ts

examples/                    # plugin-author templates (SC-004) + test fixtures
├── plugin-strategy-example/
├── plugin-source-example/
└── fixtures/                # plugin-incompatible, plugin-hang (used by e2e)

e2e/                         # Playwright: us1…us6 specs, two-node + relay harness
docs/                        # plugin author guide, agent guide, self-hosting the relay
```

**Structure Decision**: The repo is a pnpm monorepo of 5 packages plus first-party plugins.
`core` is isomorphic so that the UI (owner's local edits), the node (agent commands) and the
relay (signature and ACL verification) share one implementation of the rules. `plugin-sdk` is
kept separate and dependency-light because third parties depend on it. First-party plugins live
outside `packages/` and are built and installed exactly like external ones.

## Delivery increments (input for `/speckit-tasks`)

| Increment | Stories | Builds |
|-----------|---------|--------|
| 0 — Foundation | — | monorepo/tooling/CI, `core` model + commands, `plugin-sdk` contracts + test kits, node skeleton (server, repo, security), UI shell, plugin host + sandbox |
| 1 — MVP | US1 | decisions/options UI, manual-pick strategy plugin, outcome history, persistence, export |
| 2 | US2 | Rng + verification, random/weighted plugins, strategy chooser, example strategy plugin, docs |
| 3 | US3 | idea pool, idea-source host flow, clipboard plugin, OAuth broker, Google Docs plugin |
| 4 | US4 | grants, agentic API (MCP + REST), agent brief, review UI, audit log, test agent |
| 5 | US5 | identity/crypto, relay, sync client, invites/revocation, ballots + plurality plugin, agent tunnel |
| 6 | US6 | plugin area: install from file/URL, permission review, settings forms, compatibility + failure UX |

Plugin *hosting* belongs to Increment 0, because US1's manual pick is already a plugin. The
plugin *management UI* is US6.

## Complexity Tracking

> No constitution violations. These entries document structural choices for reviewers.

| Choice | Why Needed | Simpler Alternative Rejected Because |
|--------|------------|-------------------------------------|
| Separate `relay` package and deployable | FR-027 requires an optional, self-hostable sync service, and remote agents need a tunnel | Embedding sync in the node would make every user a server; a hosted service was rejected in Q1 |
| Plugins run in browser iframes rather than the node | An enforceable permission boundary (C2) and failure isolation (C3) | Node permission model `--allow-net` is experimental and had bypass CVEs in 2026 (R4) |
| Two agent transports (MCP + REST) | MCP for agent-native clients; REST/OpenAPI for everything else (FR-016/017) | MCP-only excludes non-MCP agents. Both come from one schema, so the cost is low |
| End-to-end encryption in v1 | FR-027a: the relay must not read content | Plaintext relay contradicts Principle V and the clarified spec |
