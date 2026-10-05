# Deciginator — agent guide

Open-source, modular decision-making engine (ideas → options → strategy → outcome → share),
local-first, plugin-based, agent-native.

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

From `specs/001-decision-engine-core/plan.md` and its `research.md`:

- TypeScript (strict, ESM), Node.js 24 LTS, pnpm 10 workspaces, Biome, Vitest, Playwright and
  axe, Changesets.
- `packages/core`: isomorphic domain model, commands and crypto. Uses Zod 4, Automerge 3 and
  `@noble/*`.
- `packages/plugin-sdk`: plugin contracts, the RPC client and the contract test kits.
- `packages/node`: the local node on `127.0.0.1:4178`. Built with Hono, automerge-repo 2, the
  MCP TS SDK v2 and REST/OpenAPI, plus the OAuth broker and the relay client.
- `packages/ui`: React 19, Vite, Radix and rjsf. Plugins run in sandboxed iframes with CSP.
- `packages/relay`: self-hostable, stores E2E-encrypted change logs in SQLite, and runs the
  agent tunnel.
- `plugins/*`: first-party strategies and idea sources, packaged like third-party plugins.

## Contracts

`specs/001-decision-engine-core/contracts/` contains the plugin manifest schema, the plugin
runtime RPC, the strategy (with the normative RNG and test vectors), the idea source, the
agentic API and the relay protocol. Change one only together with a version bump and a
changeset.
