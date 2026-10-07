# Deci — agent guide

Open-source, modular decision-making engine (ideas → options → grades/votes → outcome → share),
plugin-based, agent-native. Product name: Deci; the repo, npm scope and technical IDs use
`decisionator`. The MVP is a static web app that stores each project as a Google Sheet in the
owner's Drive; local-first mode comes later (US7).

## Read first

- `.specify/memory/constitution.md` — non-negotiable principles. Every plan and PR must comply.
- `.specify/feature.json` — points at the feature currently in progress under `specs/`.

## Workflow (GitHub Spec Kit)

Non-trivial work goes through the Spec Kit skills, in order:
`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-analyze` → `/speckit-implement`.

- Specs (`spec.md`) say *what/why*, no tech. Plans (`plan.md`) say *how*.
- One feature per branch: `NNN-short-name`, matching `specs/NNN-short-name/`.
- Scripts are PowerShell (`.specify/scripts/powershell/`); `.ps1` files keep CRLF, everything
  else is LF (see `.gitattributes`).

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …).
- Built-in plugins use only the public plugin API — never add core special cases for them.
- Contract tests first for plugin contracts, strategies and the agentic API.
- Never commit credentials (Google OAuth tokens, API keys); see `.gitignore`.

## Tech stack

From `specs/001-decision-engine-core/plan.md` (MVP = US1–US3):

- TypeScript (strict, ESM), pnpm 10 workspaces, Biome, Vitest, Playwright + axe, Changesets.
  Node.js 24 LTS for tooling.
- `apps/web`: React 19 + Vite SPA on GitHub Pages (hash routing). Radix, dnd-kit, idb,
  vite-plugin-pwa.
- `packages/core`: Zod model, format instruction/extraction/validation, stats, WebCrypto password
  codec, SHA-256 counter RNG, export.
- `packages/plugin-sdk`: ProjectStore / IdeaSource / Strategy contracts, StorageManager, contract test kits and
  the fake Google backend (MSW).
- `plugins/store-google-sheets`, `plugins/store-file`, `plugins/store-firestore`, `plugins/share-inpage`, `plugins/source-paste`, `plugins/strategy-borda`: first-party
  modules.
- Universal Storage: defaults to local file (`.decisionator.json` via File System Access API) if no remote store is activated; Firestore and Google Drive backends selectable via Storage Settings.
- Live sessions (`share-inpage`, contract `specs/004-live-share-network/contracts/live-share.md`):
  the owner's tab hosts guests over WebRTC data channels (star); offers go sealed through Nostr
  relays or BroadcastChannel. Guest entries are recorded via `append(..., { onBehalfOf })`
  (ProjectStore v1.2.0). The hosting session lives in `LiveShareProvider`, not in a page.
- Option properties and option view (feature 005, contracts in
  `specs/005-option-status-properties/contracts/`): plugins declare typed `optionProperties`
  (stored as `property` entries, shared or per person) and return declarative contributions for
  fixed places on the option card, detail view and list. The host
  (`apps/web/src/features/option-view/OptionExtensionsProvider`) renders them and reports
  exposure (time on screen). The built-in `plugins/option-status` ("Seen" marks) uses only these
  hooks. Per-person values are shown only to their author.
- History and resets (ProjectStore v1.4.0): stores append every grade, ballot and property, and
  build snapshots with `effectiveEntries` (latest wins plus `reset` entries); superseded entries
  are in `snapshot.history`. Stamp new entries with `monotonicNow()`.
- Decision method: `project.strategy` (meta) is chosen by the owner and used by "Close voting";
  `apps/web/src/features/decide/strategies.ts` and `compare.ts` (input-derived seeds).
- Google: Identity Services token model, `drive.file` scope only, Drive v3 + Sheets v4 via
  `fetch`, Picker `setFileIds`. Tokens live in memory. Stay under the quota budget in
  `contracts/sheet-store.md`.
- Later: `packages/node` (MCP/REST agent API, US5), plugin sandbox (US6), `packages/relay` and
  Automerge local store (US7).

## Contracts

`specs/001-decision-engine-core/contracts/` contains:
- MVP: options format, format instruction, project store, Google Sheet layout, strategy (RNG
  vectors), idea source.
- Later: plugin manifest and runtime (US6), agentic API (US5), relay protocol (US7). Change one only together with a version bump and a
changeset.
