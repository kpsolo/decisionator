# Deciginator

An open-source, modular **decision-making engine**.

Collect ideas, turn them into options, enrich them (by hand or with your own AI agent),
then decide — by picking yourself, rolling a randomizer, or running a custom strategy.
Share the decision with friends and collaborators.

> Status: **pre-alpha / specification phase.** Development follows
> [Spec-Driven Development](https://github.com/github/spec-kit).

## Core ideas

- **Everything is a module.** Idea sources, decision strategies, enrichers and UI panels are
  plugins built on a small, stable core.
- **Simple by default, extensible in depth.** The default UI is a handful of obvious actions;
  every plugin can expose detailed settings for people who want them.
- **Pluggable idea stores.** Clipboard and Google Docs ship in the box; others (e.g. Obsidian)
  can be written as third-party plugins.
- **Agent-native.** A documented agentic API lets *your own* agent research and attach
  information to ideas and options.
- **Collaborative.** Decisions can be shared with others who can view, contribute and vote.

## Repository layout

| Path | Purpose |
|------|---------|
| `.specify/memory/constitution.md` | Project principles — read this first |
| `specs/` | Feature specifications, plans and tasks (one folder per feature) |
| `.specify/` | Spec Kit templates, scripts and extensions |
| `.claude/skills/` | Spec Kit commands for Claude Code (`/speckit-*`) |

## Development workflow

This repo uses [GitHub Spec Kit](https://github.com/github/spec-kit). With Claude Code:

1. `/speckit-specify <feature description>` — write the spec (what & why)
2. `/speckit-clarify` — resolve open questions
3. `/speckit-plan <tech choices>` — design (how)
4. `/speckit-tasks` — break into tasks
5. `/speckit-analyze` — cross-check spec/plan/tasks
6. `/speckit-implement` — build

## License

[MIT](LICENSE)
