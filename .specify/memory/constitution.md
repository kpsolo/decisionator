<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: n/a (initial ratification)
- Added principles:
  I. Minimal Core, Everything Is a Module
  II. Stable, Versioned Plugin Contracts
  III. Simple by Default, Deep on Demand
  IV. Agent-Native by Design
  V. User Owns the Data
  VI. Transparent, Reproducible Decisions
  VII. Test-First for Contracts and Strategies
- Added sections: Plugin & Integration Constraints; Development Workflow & Quality Gates; Governance
- Removed sections: none
- Templates reviewed: plan-template.md (Constitution Check reads this file at runtime — no edit
  needed), spec-template.md, tasks-template.md — no changes required
- Deferred TODOs: none
-->

# Deciginator Constitution

Deciginator is an open-source, modular decision-making engine: people collect ideas, shape them
into options, enrich them (manually or through their own AI agents), decide using a pluggable
strategy, and share the result with collaborators.

## Core Principles

### I. Minimal Core, Everything Is a Module

The core MUST stay small: it owns only the domain model (decisions, ideas, options,
contributions, outcomes), the plugin host, persistence boundaries and the public API.
Every capability beyond that — idea sources, decision strategies (manual pick, randomizer,
custom), enrichers, sharing transports and UI panels — MUST be implemented as a module that
plugs into a documented extension point.

- First-party modules MUST use only the same public plugin API available to third parties.
  No private hooks, no special cases in the core for bundled plugins.
- A module MUST be removable without breaking the core or unrelated modules.
- New extension points require a written spec describing the contract before implementation.

Rationale: the product's value is its extensibility; the only way to guarantee third-party
plugins are first-class is to build our own features the same way.

### II. Stable, Versioned Plugin Contracts

Every extension point MUST have an explicit, machine-readable contract (schema/types) and a
semantic version.

- Each plugin MUST ship a manifest declaring: id, version, the contract versions it targets,
  the extension points it implements, the permissions it needs (network hosts, clipboard,
  file access, credentials) and its user-configurable settings schema.
- Breaking a contract requires a MAJOR version bump, a deprecation notice in the previous
  MINOR release, and a migration note.
- The host MUST refuse to load a plugin whose declared contract version is incompatible, and
  MUST report why in plain language.

Rationale: an open plugin ecosystem only survives if plugin authors can trust the ground
under them.

### III. Simple by Default, Deep on Demand

The default experience MUST let a first-time user go from "I have a few ideas" to "decision
made" without reading documentation or opening settings.

- The primary flow (add ideas → see options → decide → share) MUST be reachable with a
  handful of obvious actions and sensible defaults; no mandatory configuration.
- Advanced behaviour MUST live behind progressive disclosure (per-plugin settings panels,
  generated from each plugin's settings schema), never in the primary flow.
- Plugins MAY contribute UI, but only through defined UI slots; a plugin MUST NOT be able to
  hijack or clutter the primary flow.

Rationale: decision tools fail when deciding *how* to decide becomes harder than the decision.

### IV. Agent-Native by Design

Every user-facing capability MUST be available through a documented, versioned programmatic
API that AI agents can use, with parity to the UI.

- A user MUST be able to invite *their own* agent (not a vendor-locked one) to work on a
  decision, idea or option — e.g. research and attach findings — using scoped,
  revocable, time-limited access.
- Agent contributions MUST be attributed (which agent, on whose behalf, when, with which
  sources) and visually distinguishable from human input.
- Agent contributions MUST NOT silently change a decision's outcome; they add information that
  humans can accept, edit or dismiss.
- The API MUST be self-describing enough that an agent can discover available actions without
  out-of-band documentation (e.g. a published schema/tool description).

Rationale: the headline feature is "ask your own agent to help, then share" — that requires
agents to be first-class, auditable participants.

### V. User Owns the Data

Users MUST stay in control of their ideas, decisions and credentials.

- Nothing leaves the user's environment (to a share target, external store, or agent) without
  an explicit user action or a grant the user created and can revoke.
- Credentials and tokens (e.g. Google OAuth) MUST never be stored in plaintext in project
  files, logs, share links or exported data, and MUST never be exposed to plugins that did not
  declare and receive that permission.
- Users MUST be able to export all their data in an open, documented format and delete it.
- Third-party integrations request the minimum scopes needed (least privilege).

Rationale: people put personal and sensitive deliberations into a decision tool; trust is the
product.

### VI. Transparent, Reproducible Decisions

Every decision outcome MUST be explainable and, where randomness is involved, reproducible.

- Each outcome records which strategy (id + version) and settings produced it, the inputs it
  saw, and who triggered it.
- Random strategies MUST use a recorded seed so the same inputs and seed reproduce the same
  result, letting collaborators verify fairness.
- Decision history MUST be append-only; re-deciding creates a new outcome rather than
  overwriting the previous one.

Rationale: shared decisions need to be trusted by everyone involved, not just the person who
pressed the button.

### VII. Test-First for Contracts and Strategies

Tests MUST be written and observed failing before implementation for:

- every plugin contract (contract tests that any implementation, first- or third-party, can
  run against itself);
- every bundled decision strategy (deterministic tests, including seeded randomizer cases);
- the agentic API (contract tests for each operation and its permission checks).

Other code SHOULD follow test-first; any exception MUST be justified in the plan's
Complexity Tracking table.

Rationale: contracts and strategies are the parts others depend on; regressions there break
the ecosystem.

## Plugin & Integration Constraints

- **Bundled idea stores**: clipboard and Google Docs ship with the project. Other stores
  (e.g. Obsidian) MUST be implementable as external plugins without core changes; they are
  explicitly out of the bundled scope.
- **Permission model**: plugins run with only the permissions declared in their manifest and
  granted by the user. Network access is limited to declared hosts.
- **Failure isolation**: a failing or slow plugin MUST NOT crash the host or block the primary
  flow; errors surface as user-readable messages attributed to the plugin.
- **Offline-capable core**: creating ideas, options and decisions with local strategies MUST
  work without network access; only integrations, sharing and agents may require it.
- **Dependencies**: prefer few, well-maintained, permissively licensed (MIT/Apache-2.0/BSD)
  dependencies; licenses MUST be compatible with the project's MIT license.
- **Accessibility**: the default UI MUST meet WCAG 2.1 AA.

## Development Workflow & Quality Gates

- **Spec-Driven Development**: non-trivial features follow the Spec Kit flow —
  `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-analyze` → `/speckit-implement`. Specs describe *what/why*; plans describe *how*.
- **Constitution Check**: every plan MUST pass the Constitution Check gate before Phase 0
  research and again after Phase 1 design; violations go in Complexity Tracking with
  justification or the plan is revised.
- **Pull requests**: all changes land via reviewed PRs; CI MUST pass (lint, type checks,
  tests, contract tests). Changes to a plugin contract or the agentic API require an updated
  contract doc and changelog entry in the same PR.
- **Documentation**: each extension point ships with a minimal example plugin and author docs;
  the agentic API ships with a machine-readable description.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, …) to support automated
  changelogs and semantic versioning.

## Governance

This constitution supersedes other project practices and guidelines. Where a guideline
conflicts with it, the constitution wins.

- **Amendments**: proposed via PR that edits this file, states the motivation, includes a Sync
  Impact Report, and updates any affected templates or docs. Amendments need approval from at
  least one maintainer and a review window of 72 hours for MAJOR changes.
- **Versioning**: MAJOR for removing or redefining a principle; MINOR for adding a principle or
  materially expanding guidance; PATCH for clarifications and wording.
- **Compliance**: reviewers verify constitution compliance on every PR; plans document their
  Constitution Check. Unjustified complexity is grounds for requesting changes.
- **Runtime guidance**: day-to-day agent guidance lives in `CLAUDE.md` (generated/updated by
  `/speckit-plan`) and MUST stay consistent with this document.

**Version**: 1.0.0 | **Ratified**: 2026-10-05 | **Last Amended**: 2026-10-05
