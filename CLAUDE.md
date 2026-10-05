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

Not chosen yet — will be recorded here by the first `/speckit-plan`.
