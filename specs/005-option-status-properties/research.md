# Research: Personal Option Status and Plugin-Defined Option Properties

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-07

Starting point (from a survey of the code on `main` at `a61f2a0`):

- No plugin UI slot is rendered anywhere in `apps/web`. The manifest schema lists
  `option.detail`, `project.toolbar`, `project.sidebar` and `idea.detail`, but nothing renders
  them.
- `ModuleHost` is created only in tests. Built-ins are imported directly, and the registry's
  `enabled` flag only changes what the Plugins page shows.
- All four stores silently drop unknown entry kinds on `append` and ignore unknown data on read.
- `OptionSchema` is a strict `z.object` that strips unknown keys.
- `IntersectionObserver` is not used anywhere yet. The page scrolls on the window, and the
  header is sticky.
- `apps/web` unit tests run in Node without jsdom. Component tests use
  `renderToStaticMarkup`.

## R1 — Where property values live

**Decision**: Store values as a new append-only entry kind, `property`, next to grades and
comments. Do not add fields to `Option`.

```
{ kind: "property", optionId, plugin, key, scope: "shared" | "person", value }
```

The store stamps `by` and `at` as for every entry. Latest wins:

- per `(plugin, key, optionId)` for shared values;
- per `(by, plugin, key, optionId)` for per-person values.

`value: null` clears a value.

**Rationale**:

- Per-person values need an author, and an append-only history like grades. Option edits are
  owner-only operations with no per-person dimension.
- Entries already flow through every store, the live share, export, Move and the delegation
  rules, so one new kind reuses all of that.
- Keeping values off `Option` means a disabled or missing plugin cannot lose them through
  `OptionSchema` stripping unknown keys (FR-016).

**Alternatives considered**:

- An `extra: Record<string, unknown>` on `Option`. It is owner-only, so it cannot hold
  per-person values. It would also need every option decoder (Sheets row, xlsx, options format)
  to be made lenient.
- One record per person holding all their marks. It conflicts with latest-wins per entry and
  turns every mark into a read-modify-write.

## R2 — Who may write what, and who sees per-person values

**Decision**:

- Shared values may be written by the owner and by agents the owner invited (agent API).
- Per-person values may be written only by their author, so a guest can write only through
  `onBehalfOf` for themselves.
- `property` becomes delegatable only with `scope: "person"`. A delegated shared write is
  refused with `PERMISSION_DENIED`.
- The web app shows a participant only their own per-person values.
- The live share redacts other people's per-person values from each guest's snapshot.
- Exports keep all values, as they do for grades and ballots.

**Rationale**:

- FR-006 and FR-012.
- The project's data belongs to its owner (Constitution V), and SC-005 requires a lossless
  export and restore.
- "Visible" in FR-006 is about what the product shows. A collaborator with direct access to the
  owner's Google Sheet could read the raw `properties` tab, just as they can read raw grades
  today. This is recorded in the sheet-store contract as a known property of the Sheets
  backend, not hidden.

**Alternatives considered**:

- Encrypting per-person values for their author. The guest has no key the owner's store could
  hold, and the owner's export would become partly unreadable.
- Not storing marks at all, keeping them on the device only. That fails acceptance scenario
  US1-6 across devices for signed-in participants, and fails SC-005.

## R3 — How plugins declare properties

**Decision**: Add a manifest declaration, `provides.optionProperties`:

```
[{ key, label, type, choices?, default?, scope, cardBadge? }]
```

- `type` is one of `text | number | boolean | choice | date`.
- `key` matches `^[a-z][a-z0-9_]{0,39}$` and is unique within the plugin.
- Values are checked in `@decisionator/core` by a pure `checkPropertyValue(def, value)`, used by
  the app, the agent API and the stores' contract kit. The stores check only shape (size of
  `value` ≤ 2 KiB, JSON scalar or null), because they do not know the declarations.
- Values whose plugin is not installed are kept and passed through untouched.

**Rationale**:

- FR-011 – FR-014, FR-016.
- Namespacing by plugin id removes clashes (FR-014).
- A manifest declaration lets the host render, validate and export without running plugin code.

**Alternatives considered**:

- Declaring properties at runtime in `init()`. Built-in and sandboxed plugins would then behave
  differently, and nothing would be known before the plugin loads.
- A JSON Schema per property. It is more general than the five types the spec needs, and harder
  to render accessibly.

## R4 — How plugins change the option view

**Decision**: Use declarative view contributions rather than plugin-rendered markup.

A plugin implements `optionView(ctx) => OptionViewContribution`, where `ctx` holds:

- the option;
- the viewer's id;
- the plugin's own property values visible to the viewer;
- the plugin's settings.

The host renders the result in the fixed places from FR-020 using its own accessible components:

| Place | Contribution |
|---|---|
| `marker` | `{ variant: "dot" \| "bar" \| "bold" \| "ring", label, tone? }`, with `replace: true` to stand in for the default marker |
| `badges` | `[{ text, tone?, icon?, title? }]` |
| `footer` | `[{ text } \| { action: { id, label } }]` |
| `properties` | the host renders the plugin's declared properties (editable where FR-012 allows) |
| `sections` | `[{ title, blocks: ({ text } \| { markdown } \| { fields: [label, value][] })[] }]` |

- Actions call back `onOptionAction(ctx, actionId)`.
- Places outside this list (title, grade control, comments, ballot) do not exist in the
  contribution type, so FR-022 is enforced by construction.
- A contribution that fails schema validation, or a hook that throws, falls back to the default
  for that place with a notice (FR-024).
- Tones are design tokens (`neutral | info | success | warning | danger | primary`), so contrast
  and dark mode come from the theme (FR-025).

For the count and the unseen filter (FR-004), a project-level hook `optionList(ctx)` returns:

```
{ summary?: { text },
  filters?: [{ id, label, where: { key, is: value | null } }] }
```

- The host shows `summary` in the project's options header.
- The host offers each filter as a toggle above the list.
- It applies `where` to the plugin's own property values for the viewer, where `null` matches
  "no value".

This keeps "seen" out of the core while the list stays declarative.

**Rationale**:

- Third-party plugins run in a sandboxed iframe (`plugin-runtime.md`). One iframe per option
  card is not workable for 100 cards (SC-003), and plugin markup in the main document would
  break the sandbox.
- A data contribution crosses the existing RPC unchanged and is accessible by construction.
- Built-ins use the very same hook, as Constitution I requires.

**Alternatives considered**:

- In-process React components. They break the sandbox model and Constitution I parity, since
  only built-ins could use them.
- One iframe per slot. Too costly, and its keyboard and focus integration is fragile.
- CSS class injection. It is unbounded, could hide core controls, and offers no accessibility
  guarantees.

## R5 — Telling plugins that an option was looked at

**Decision**:

- The host owns visibility tracking, through a new capability `ctx.exposure`.
- A plugin declares `exposure: { minMs }` and receives `onOptionExposed(ctx, optionId)` once per
  page visit for each option that has been on screen for `minMs` without a break.
- The host uses one shared `IntersectionObserver` (`root: null`, thresholds `[0, 0.5, 1]`)
  over every element that registered with `exposureRef(optionId)`.
- An element counts as on screen when `intersectionRatio ≥ 0.5`, or when its visible part is
  ≥ 50 % of the viewport height (for tall cards).
- Timers pause on `document.visibilitychange` to hidden and on window `blur`, and reset when
  the element leaves.
- The timing logic is a pure `ExposureTracker` class driven by injected `now()` and events, so
  it is unit-tested in Node. The React hook is a thin adapter around it.

**Rationale**:

- FR-002, FR-003 and the edge cases on tall cards, multiple cards and ballot/results views.
- A sandboxed plugin cannot observe the host DOM, so this has to be a host capability.
- One observer for all cards keeps scrolling smooth (SC-003).

**Alternatives considered**:

- One observer per card. It works, but spends more memory and callbacks for nothing.
- Scroll listeners with `getBoundingClientRect`. They cause layout thrash.
- Letting the plugin poll. Not possible from the sandbox.

## R6 — Settings and choosing between plugins

**Decision**:

- The status plugin's `settingsSchema` holds `autoMark: boolean` (default `true`) and
  `seconds: integer` (1 – 300, default 5).
- The Settings page gains an "Options" card. It renders that schema with the existing
  `PluginSettings` (rjsf) form and a "Marker style" chooser listing every enabled plugin that
  replaces `marker`.
- The choice is stored in `deci.optionView.markerPlugin` (default: the first enabled such
  plugin).
- The host passes `seconds × 1000` as `exposure.minMs` whenever the settings change.
- Settings are per device, like the other plugin settings.

**Rationale**:

- FR-008 and FR-023.
- The spec asks for these settings to be in Settings. The Plugins page keeps the full plugin
  settings too, since it is the same form.

**Alternatives considered**: a project-level setting. Rejected: the setting is per participant
(FR-008), and the owner must not override it (spec Assumptions).

## R7 — Making `enabled` real and wiring built-ins through a host

**Decision**:

- Add an app-level `OptionExtensionsProvider`. It reads the plugin registry (now with
  `subscribe()` and a merge of new built-ins into existing registries) and holds the enabled
  plugins that provide `optionProperties`, `optionView` or `exposure`.
- Built-ins register an in-process `PluginDefinition` under their manifest id.
- Sandboxed third-party plugins are out of reach until the runtime loader exists (US6). The
  contract and the RPC method names are defined now: `optionView.render`, `optionView.action`,
  `exposure.exposed`.
- `examples/plugin-option-cost` shows a third-party style plugin through the same in-process
  path in tests (SC-004, SC-006).

**Rationale**:

- FR-016, FR-018 and US3 scenario 9 need disabling to take effect.
- The registry seeding gotcha means a new built-in would not appear for existing users, hence
  the merge.

**Alternatives considered**: instantiating `ModuleHost` app-wide now. That is the right end
state, but it is a large rewiring of strategies and stores that this feature does not need.

## R8 — Storage per backend

**Decision**:

| Store | Change |
|---|---|
| store-file | new `properties` array in the stored doc (defaults to `[]` for old docs); latest-wins in place, like grades |
| store-local (Automerge) | new `properties` list; `value: null` stored as `null` (Automerge accepts null, not undefined) |
| store-firestore | new `FirestoreEntryDoc` member `property`; latest-wins in `buildEntries` |
| store-google-sheets | new tab `properties[id,at,by,optionId,payload]`, where `payload` is the JSON `{plugin,key,scope,value,byName?}` (encrypted in password mode like the other payloads) |
| examples/plugin-store-memory | same as store-file, so the contract kit passes |

For Google Sheets:

- The tab is added by migration when it is missing, following the `contributions` migration.
- Sheet layout goes from 2.2.0 to 2.3.0; `formatVersion` stays 2 (additive).
- Rows go through the existing queue, which already groups each tab's rows into one write
  per flush (about every 2 s). A scroll that marks 12 options costs one write (quota budget:
  ≤ 20 writes per minute).

**Rationale**: the contract kit covers all five stores, and latest-wins stays where each store
already applies it.

## R9 — Live share

**Decision**:

- Add a new guest entry `{ kind: "property", optionId, plugin, key, scope: "person", value }`.
- The host accepts it only for active options and `scope: "person"`, with `value` ≤ 2 KiB.
- The host redacts other guests' per-person values from each guest's snapshot, and keeps
  shared values.
- The guest batches exposure marks and sends them at most once every 2 s (up to 50 entries per
  submit) to stay under the host's rate limit (20 burst, 5/s).
- `PROTOCOL_VERSION` goes from 2 to 3, and the contract `live-share` from 2.1.0 to 3.0.0. An
  older host would answer every mark with "invalid"; the version check gives both sides the
  existing plain message instead.

**Rationale**: FR-009 and FR-006 (redaction).

**Alternatives considered**: keeping guest marks only on the guest's device. That is simpler,
but the marks would be lost when the guest saves a copy, and it breaks the "recorded under the
guest's identity" requirement in FR-009.

## R10 — Export, restore and Move

**Decision**:

- `ProjectExportV1` gains optional `properties: PropertyValue[]` (default `[]`). The format id
  stays `decisionator.project/v1`, because the change is additive.
- The xlsx workbook gains a "Properties" sheet with columns Option, Plugin, Key, Scope, Value,
  By, By name, At, plus `Record (JSON)`.
- `copyEntriesAsAuthors` (restore and Move):
  - re-appends per-person values on behalf of each author;
  - appends shared values as the signed-in owner, as it already does for outcomes and
    contributions.

**Rationale**: FR-015 and SC-005.

## R11 — Agent API

**Decision**: `packages/node` gains:

- `GET /context`, which returns `optionProperties` (declarations of enabled plugins) and shared
  values;
- `PUT /options/{optionId}/properties/{plugin}/{key}` with `{ value }`, for shared values only,
  checked with `checkPropertyValue` and attributed to the agent (`author.kind: "agent"`);
- MCP tools `get_option_properties` and `set_option_property`.

Per-person values are not exposed to agents. They belong to people, and agents act on the
project's shared information.

The agentic API contract goes from 1.x to the next minor.

**Rationale**: FR-017 and Constitution IV (parity for the shared, owner-editable capability).

## R12 — Testing approach

- Contract tests first:
  - `runProjectStoreContractTests` gains property cases: latest-wins per scope, `null` clears,
    delegated person-only, unknown plugin pass-through, size limit;
  - the share-inpage host/guest tests gain property submit, refusal and redaction cases.
- Pure units:
  - `checkPropertyValue`;
  - `ExposureTracker` (fake clock: 4.9 s does not mark, 5 s does; hidden pauses; leave resets;
    tall element);
  - the status plugin's `optionView` and `onOptionExposed` logic;
  - view-contribution validation and fallback.
- Static-markup tests for the option view places with `renderToStaticMarkup`.
- Playwright:
  - a local project with 12 options, scrolled, showing marks and the "N not seen yet" count;
  - Settings at 10 s;
  - disabling the status plugin;
  - the example cost plugin's badge and property, with export → restore;
  - a live guest's marks hidden from the host;
  - axe on the card, the lightbox and Settings.
- Real-time waits are kept short by setting the status plugin to 1 s in e2e, except for one
  test that checks the 5 s default.
