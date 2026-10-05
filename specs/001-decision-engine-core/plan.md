# Implementation Plan: Decision Engine Core

**Branch**: `001-decision-engine-core` | **Date**: 2026-10-05 (revised for the Google-based MVP) |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-decision-engine-core/spec.md`

## Summary

The **MVP (US1–US3)** is a static web app, Deci, hosted on GitHub Pages. It runs
entirely in the browser and has no backend of its own.

**User flow:**
1. A user pastes a raw idea list.
2. Without a connected AI, they take a versioned format instruction to any AI assistant and paste
   back JSON in the `decisionator.options/v1` format. Deci validates it and shows a preview.
3. Deci creates the project as a Google Sheet in the user's own Drive, using only the
   non-sensitive `drive.file` scope.
4. The owner shares it by link (view or contribute), optionally with a password. The password
   triggers AES-GCM encryption in the browser.
5. Collaborators grade options 1–5, comment and submit ranked votes. Every input is appended as
   its own row, so collaborators never conflict.
6. Everyone sees sortable and groupable stats. The owner closes voting, and a deterministic Borda
   strategy records an immutable, verifiable outcome.

**Quotas:** the app stays inside Google's free quotas. It polls Drive versions cheaply, reads the
Sheet only when it has changed, queues writes and backs off on rate limits.

**Modules:** storage, idea input and tallying are modules behind public contracts (project store,
idea source, strategy).

**After the MVP:** strategies (US4), the connected-AI agent API (US5), plugins and more sources
(US6) and local-first mode with an E2E relay (US7) follow, reusing the earlier design in
[research.md](./research.md) R2–R9.

## Technical Context

**Language/Version**: TypeScript (strict, ESM). The browser runtime targets evergreen browsers.
Node.js 24 LTS is used for tooling only in the MVP.

**Primary Dependencies**:
- UI: React 19, Vite, React Router (hash routing for static hosting), Radix UI, `@dnd-kit` (drag
  to rank), markdown-it + DOMPurify.
- Data and schemas: Zod 4 (schemas, also exported as JSON Schema), `idb` (IndexedDB).
- Offline: `vite-plugin-pwa` / Workbox (app shell).
- Google: Google Identity Services (token model) and the Google Picker. Drive v3 and Sheets v4
  are called through `fetch` (no Google SDK bundle).
- Crypto: WebCrypto (PBKDF2, AES-GCM) and `@noble/hashes` (RNG, SHA-256).

**Storage**:
- One Google Sheet per project in the owner's Drive, with append-only rows
  ([contracts/sheet-store.md](./contracts/sheet-store.md)).
- IndexedDB for drafts, the write queue and offline snapshots.
- No server-side storage.

**Testing**:
- Vitest for unit tests and contract kits (project store, strategy, options-format fixtures).
- A **fake Google backend** built on Mock Service Worker (in-memory Drive and Sheets, with 429
  simulation).
- Playwright plus `@axe-core/playwright`, with two browser contexts for collaboration.
- A manual live-Google checklist before each release.

**Target Platform**: The web app is served from `https://kpsolo.github.io/decisionator/`, and the
base URL is configurable for forks. It supports the last 2 versions of Chromium, Firefox and
Safari, desktop and mobile, down to 360 px wide.

**Project Type**: A static web application in a pnpm monorepo: app, core library, plugin SDK and
first-party plugin packages.

**Performance Goals**:
- App interactive in ≤ 2.5 s on a mid-range phone over 4G.
- Stats sort and group over 200 options in < 1 s (SC-008).
- Collaborator input visible in ≤ 30 s for 95% of cases (SC-004).
- Paste to saved project in < 3 min, including the AI round trip (SC-001).

**Constraints**:
- Zero backend and zero server cost (SC-009).
- Only the `drive.file` scope.
- Tokens and keys in memory only.
- ≤ 20 Sheets reads and ≤ 20 writes per minute per client.
- Polling only while the tab is visible.
- WCAG 2.1 AA.

**Scale/Scope**:
- ≤ 200 options and ≤ 20 active collaborators per project.
- About 8 MVP screens: home/My projects, new project (paste, format, preview), project (options
  list and option detail), stats, vote, results, share, settings.

All Technical Context items are resolved in [research.md](./research.md) (R18–R28 for the MVP).
One item is open as a **spike**, not a clarification: Picker `setFileIds` on link-shared files
(R21). It has defined fallbacks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle / Constraint | MVP compliance | Pre | Post |
|---|------------------------|----------------|:---:|:---:|
| I | Minimal core, everything is a module | Storage (`store-google-sheets`), input (`source-paste`) and tally (`strategy-borda`) are modules behind public contracts in `plugin-sdk`. The core holds only model, stats, validation, crypto and the RNG. | ✅ | ✅ |
| II | Stable, versioned contracts | `decisionator.options/v1`, format instruction v1, project-store v1, Sheet format v1 and strategy v1 are versioned in [contracts/](./contracts/). The Sheet carries `formatVersion`. | ✅ | ✅ |
| III | Simple by default | The primary flow is paste → format → preview → create → grade → share → vote. Settings sit behind Share, Voting and project Settings. | ✅ | ✅ |
| IV | Agent-native | **Partial (D1).** Any agent can take part through the published format contract. API parity, scoped grants and agent contributions arrive in US5. | ⚠️ | ⚠️ |
| V | User owns the data | Projects live in the user's own Drive, created only on an explicit action. Least-privilege `drive.file` scope. Optional password encryption. Export. No server of ours. | ✅ | ✅ |
| VI | Transparent, reproducible decisions | Append-only rows. Outcomes record strategy and version, the input snapshot, the tie-break and the seed. Verify re-runs the tally. | ✅ | ✅ |
| VII | Test-first for contracts and strategies | Contract kits for project store and strategy, format fixtures, and RNG vectors, written before implementation (ordered in tasks.md). | ✅ | ✅ |
| C1 | Bundled stores: clipboard + Google; Obsidian external | Paste input and Google (Sheets as store) in the MVP. The Google Docs source in US6. Obsidian stays external. | ✅ | ✅ |
| C2 | Permission model for plugins | **Deferred (D3).** No third-party plugins can load in the MVP. The sandbox (R4) ships with US6. | ✅ | ✅ |
| C3 | Failure isolation | Module calls are wrapped with timeouts and error boundaries. A full sandbox arrives with US6. | ✅ | ✅ |
| C4 | Offline-capable core | **Partial (D2).** Drafts, preview and the grade/comment queue work offline. Creating and syncing a project needs Google. Full offline arrives with US7. | ⚠️ | ⚠️ |
| C5 | Permissive dependencies | All MIT, Apache-2.0, ISC or BSD (dnd-kit MIT, idb ISC, Workbox MIT, MSW MIT). | ✅ | ✅ |
| C6 | WCAG 2.1 AA | Radix primitives, a keyboard alternative for drag ranking, and axe in E2E. | ✅ | ✅ |
| W | Workflow gates | Spec Kit flow, Conventional Commits, CI gates. | ✅ | ✅ |

**Result**: PASS with two justified, time-boxed deviations (D1, D2) and one deferral (D3),
recorded in Complexity Tracking. Each is resolved by a named later story.

## Project Structure

### Documentation (this feature)

```text
specs/001-decision-engine-core/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── options-format.schema.json   # MVP: what the AI returns
│   ├── format-instruction.md        # MVP: prompt + correction prompt
│   ├── project-store.md             # MVP: storage extension point
│   ├── sheet-store.md               # MVP: Google Sheet layout, sync and quota budget
│   ├── strategy.md                  # MVP: Borda; US4: random/weighted (RNG vectors)
│   ├── idea-source.md               # MVP: paste; US6: Google Docs
│   ├── plugin-manifest.schema.json  # US6
│   ├── plugin-runtime.md            # US6
│   ├── agentic-api.md               # US5
│   └── relay-protocol.md            # US7
├── checklists/requirements.md
└── tasks.md                         # /speckit-tasks
```

### Source Code (repository root)

```text
package.json, pnpm-workspace.yaml, biome.json, tsconfig.base.json, .changeset/
.github/workflows/ci.yml             # lint, typecheck, test, e2e
.github/workflows/pages.yml          # build apps/web → GitHub Pages

apps/
└── web/                             # @decisionator/web — the SPA
    ├── src/routes/                  # home, new, project/:fileId, stats, vote, results, share, settings
    ├── src/features/                # paste-format, preview, grading, comments, stats, voting, sharing
    ├── src/host/                    # module host: loads first-party modules via plugin-sdk contracts
    ├── src/sync/                    # snapshot cache, write-queue UI, "syncing paused" banner
    ├── e2e/                         # Playwright us1…us3 + axe
    └── .env.example                 # VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, VITE_BASE_URL

packages/
├── core/                            # @decisionator/core — isomorphic, no I/O
│   ├── src/model/                   # Zod: Project, Option, Grade, Comment, Ranking, Outcome
│   ├── src/format/                  # instruction builder, JSON extraction, validation, correction prompt
│   ├── src/stats/                   # aggregates, sort/group
│   ├── src/crypto/                  # PBKDF2 + AES-GCM payload codec
│   ├── src/rng/                     # normative SHA-256 counter RNG
│   ├── src/export/                  # decisionator.project/v1
│   └── test/                        # incl. fixtures/format-answers/ (SC-002)
└── plugin-sdk/                      # @decisionator/plugin-sdk — contracts + test kits
    ├── src/                         # ProjectStore, IdeaSource, Strategy types
    └── testing/                     # runProjectStoreContractTests, runStrategyContractTests, vectors.json, fake-google (MSW)

plugins/                             # first-party modules, packaged like third-party ones
├── store-google-sheets/             # GIS auth, Drive/Sheets/Picker client, quota budget, queue, password codec use
├── source-paste/                    # plain-list parser + format round trip (idea-source contract)
└── strategy-borda/                  # truncated Borda + tie-break chain

# Later increments add: packages/node (US5/US7), packages/relay (US7),
# plugins/strategy-{owner-pick,random,weighted} (US4), plugins/source-google-docs (US6),
# plugins/store-local (US7) and docs/ for plugin authors.
```

**Structure Decision**:
- `apps/web` is the only deployable in the MVP.
- `core` and `plugin-sdk` stay framework-free, so the US5 node and the US7 local store can reuse
  them unchanged.
- First-party modules live in `plugins/`, so moving them into the US6 sandbox later changes
  packaging, not contracts.

## Delivery increments (input for `/speckit-tasks`)

| Increment | Stories | Builds | Exit check |
|-----------|---------|--------|------------|
| 0: Foundation | — | Monorepo, CI, Pages deploy. Core model, stats, RNG, crypto. plugin-sdk contracts and kits. Fake Google backend. App shell. **Spike: Picker `setFileIds` on a link-shared Sheet** | Spike result recorded in research R21 |
| 1 | US1 | Paste, format instruction, extract and validate, preview. Google sign-in. Create Sheet. Grades and comments. Stats. My projects | US1 quickstart passes |
| 2 | US2 | Share (link roles, invite by email), collaborator open flow, password mode, polling sync, write queue and back-off | US2 quickstart passes |
| 3 | US3 | Voting rounds, drag and keyboard ranking, Borda strategy, outcomes, Verify, results view | **MVP release v0.1** |
| 4 | US4 | Owner pick, random, weighted-by-grade strategies and the strategy chooser | — |
| 5 | US5 | Local node with MCP and REST agent API, connected-AI formatting, agent requests and review UI | — |
| 6 | US6 | Plugin sandbox, manifest install, settings forms, Google Docs source | — |
| 7 | US7 | Local store (Automerge), E2E relay, import and export between modes | — |

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|-------------------------------------|
| **D1**: Agent API parity deferred to US5 (Principle IV partial) | The owner's MVP needs any agent to work with zero integration. The copy-paste format contract does that. | Shipping MCP/REST now needs a local node, which the hosted MVP doesn't have; that is the US5 scope. |
| **D2**: Offline limited to drafts and the queue (C4 partial) | Google-backed storage and sharing need network, by the owner's choice. | A local store now duplicates US7. Drafts and the queue keep users from losing work. |
| **D3**: Plugin sandbox deferred to US6 | Only first-party modules exist in the MVP. They already use the public contracts. | Building the sandbox before any third-party plugin exists is premature. |
| Client-side encryption for passwords | Google sharing has no passwords. Only encryption makes the data unreadable without one (SC-007). | A password gate without encryption leaves the Sheet readable. |
| Fake Google backend in tests | CI must not depend on real Google accounts or quotas. | Live-API tests are flaky and burn the shared quota; a live checklist covers release. |
