---

description: "Task list for 005 personal option status and plugin-defined option properties"
---

# Tasks: Personal Option Status and Plugin-Defined Option Properties

**Input**: Design documents from `specs/005-option-status-properties/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution VII requires contract tests before the store and host
changes, and the spec defines an independent test per story.

**Format**: `- [ ] T### [P?] [Story?] Description with file path`

## Phase 1: Setup

- [x] T001 Scaffold the built-in plugin package `plugins/option-status/`:
  - `package.json` (`@decisionator/option-status`, deps `@decisionator/core` and
    `@decisionator/plugin-sdk`, scripts as in `plugins/strategy-borda/package.json`);
  - `tsconfig.json`;
  - an empty `src/index.ts`;
  - a placeholder `decisionator-plugin.json`;
  - `test/`.
- [x] T002 [P] Scaffold `examples/plugin-option-cost/` (`README.md`, `decisionator-plugin.json`,
  `src/index.ts`, `test/`) and `examples/plugin-unread-bar/` (same files), following
  `examples/plugin-strategy-example/`.
- [x] T003 Wire the new packages into the workspace:
  - aliases for `@decisionator/option-status` in `vitest.config.ts`,
    `apps/web/vitest.config.ts`, `apps/web/vite.config.ts` and the tsconfig `paths` used by
    `apps/web`;
  - `"@decisionator/option-status": "workspace:*"` in `apps/web/package.json`;
  - then `pnpm install`.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the generic option-properties and option-view extension points, storage in every
store, and the host plumbing. No story can be shown without them.

### Tests first (expected to fail until the matching implementation lands)

- [x] T004 [P] Write `packages/core/test/property.test.ts` for `checkPropertyValue` and the
  definition schema:
  - key `^[a-z][a-z0-9_]{0,39}$`;
  - label "1–40 chars";
  - `choices` "required for `choice` (1–20 items), forbidden otherwise";
  - value rules:
    - `text`: string of 1–500 chars;
    - `number`: finite number;
    - `boolean`;
    - `choice`: one of `choices[].value`;
    - `date`: `YYYY-MM-DD` that is a real calendar date (2026-02-30 is refused);
  - "`null` is always accepted";
  - `default` must itself pass.
- [x] T005 Add property cases to `runProjectStoreContractTests` in
  `packages/plugin-sdk/testing/project-store-kit.ts`, per contracts/option-properties.md
  "Storage" rules 1–6:
  - latest wins per `(plugin, key, optionId)` for `shared` and per
    `(by, plugin, key, optionId)` for `person`;
  - `value: null` clears;
  - a non-owner `shared` append → `PERMISSION_DENIED`;
  - `onBehalfOf` with `scope: "person"` is recorded under the delegate, with `shared` →
    `PERMISSION_DENIED`;
  - an unknown plugin id is returned unchanged;
  - a serialized `value` over 2 KiB is refused;
  - an unknown `optionId` is refused;
  - password-protected projects round-trip the value.
- [x] T006 [P] Write `packages/plugin-sdk/test/option-view.test.ts` for `validateContribution`:
  - `badges` "≤ 3, text ≤ 24";
  - `footer` "≤ 3";
  - `sections` "detail view only, ≤ 2";
  - marker `variant` in `dot | bar | bold | ring`;
  - tones in `neutral | info | success | warning | danger | primary`;
  - list `summary` "≤ 40 chars";
  - invalid parts are dropped per place while valid places are kept.
- [x] T007 [P] Write `apps/web/src/features/option-view/exposure-tracker.test.ts` (fake clock),
  per data-model.md ExposureTracker:
  - 4 999 ms is not emitted, 5 000 ms is;
  - leaving resets;
  - hidden page pauses and visible resumes;
  - ratio 0.4 with `visibleHeight ≥ 0.5 × viewportHeight` counts (tall card);
  - several ids emit together;
  - each id is emitted once per tracker instance;
  - `setMinMs` applies to running timers.

### Core and SDK

- [x] T008 Create `packages/core/src/model/property.ts`:
  - `OptionPropertyDefinitionSchema` and `PropertyValueSchema` per data-model.md;
  - `PropertyScalar`;
  - `checkPropertyValue(def, value): { ok: true } | { ok: false; message }`, with messages like
    "Cost per person: enter a number";
  - `effectivePropertyValues(entries)` (latest-wins helper reused by stores and the host).
  
  Export them from `packages/core/src/model/index.ts`. T004 should pass.
- [x] T009 In `packages/plugin-sdk/src/project-store.ts`:
  - add `{ kind: "property"; optionId; plugin; key; scope: "shared" | "person"; value }` to
    `Entry`;
  - add `properties?: PropertyValue[]` to `ProjectSnapshot`.
  
  In `packages/plugin-sdk/src/delegation.ts`, add `property` to `DELEGATABLE_ENTRY_KINDS`, valid
  only when `scope === "person"` (otherwise `PERMISSION_DENIED`), and add a unit test in
  `packages/plugin-sdk/test/delegation.test.ts`.
- [x] T010 [P] Create `packages/plugin-sdk/src/option-view.ts`:
  - the zod schemas for `OptionViewContribution`, `OptionListContribution`, `Block` and `Tone`
    (data-model.md);
  - `validateContribution` returning `{ value, droppedPlaces }`.
  
  In `packages/plugin-sdk/src/runtime.ts`, extend `PluginDefinition` with `optionView`,
  `optionList`, `onOptionAction`, `onOptionExposed` and `exposureMs`, and add the
  `OptionViewContext`, `OptionListContext` and `ExposureContext` types from
  contracts/option-view.md. Export them from `packages/plugin-sdk/src/index.ts`. T006 should
  pass.
- [x] T011 Extend `specs/001-decision-engine-core/contracts/plugin-manifest.schema.json`:
  - `provides.optionProperties` (≤ 20, the definition shape);
  - `provides.optionView { places[], replaces[] }`;
  - `provides.exposure: boolean`;
  - `platform.optionProperties` and `platform.optionView`.
  
  In `apps/web/src/host/module-host.ts`, update `PluginManifest` and `HOST_PLATFORM_VERSIONS`:
  `projectStore: "1.4.0"`, `optionProperties: "1.0.0"`, `optionView: "1.0.0"`. Make
  `validateManifest` refuse duplicate keys and bad `choices`, naming the property. Add cases to
  `apps/web/src/host/module-host.test.ts`.

### Stores (each makes the T005 kit pass for that store)

- [x] T012 [P] `plugins/store-file/src/file-store.ts`:
  - `StoredFileProject.properties` (missing → `[]`);
  - the `append` branch with the shape checks and owner check;
  - latest-wins in place;
  - encryption of `value` in password mode, as for comment bodies;
  - included in `openProject` and file sync.
- [x] T013 [P] `plugins/store-local/src/store.ts`: an Automerge `properties` list (store `null`,
  never `undefined`), the append branch and `openProject`.
- [x] T014 [P] `plugins/store-firestore/src/collections.ts`: a `property` member of
  `FirestoreEntryDoc`. `plugins/store-firestore/src/firestore-store.ts`: the `append` branch,
  plus latest-wins in `buildEntries`.
- [x] T015 [P] Google Sheets:
  - `plugins/store-google-sheets/src/layout.ts`: tab `properties[id,at,by,optionId,payload]`,
    in `TAB_HEADERS` and the create list;
  - `src/sheet-store.ts`:
    - add the tab to `PAYLOAD_TABS`;
    - migrate a missing tab (`addSheets` plus a header write), like the contributions migration;
    - append rows through the queue;
    - apply latest-wins on read;
  - `src/rows.ts`: `decodePropertyRow` with per-row warnings
    `"properties row <n>: ..."`;
  - extend `plugins/store-google-sheets/test/` with a migration test against the fake Google
    backend.
- [x] T016 [P] `examples/plugin-store-memory/src/`: property support so its
  `test/contract.test.ts` passes.
- [x] T017 Update the contract documents:
  - `specs/001-decision-engine-core/contracts/project-store.md` → 1.4.0 (rules 1–7 from
    contracts/option-properties.md, plus a changelog row);
  - `specs/001-decision-engine-core/contracts/sheet-store.md` → 2.3.0 (properties tab,
    migration, the raw-sheet visibility note from research R2);
  - `specs/001-decision-engine-core/contracts/plugin-runtime.md` → minor bump (new hooks and RPC
    names `optionView.render`, `optionList.render`, `optionView.action`, `exposure.exposed`);
  - add `.changeset/option-properties.md` (minor for core, plugin-sdk and the four stores).

### Host plumbing (`apps/web`)

- [x] T018 `apps/web/src/features/plugins/plugin-registry.ts`:
  - add `subscribe(cb)`, notifying on `updatePlugin` and on `storage` events;
  - merge built-in manifests that are missing from an existing stored registry, keeping user
    `enabled` and `settings` choices.
  
  Test both in `apps/web/src/features/plugins/plugin-registry.test.ts` (in-memory localStorage
  stub).
- [x] T019 Create `apps/web/src/features/option-view/builtins.ts`, mapping manifest id → in-process
  `PluginDefinition`; it starts empty and is filled in T029.

  Create `apps/web/src/features/option-view/OptionExtensionsProvider.tsx`. It:
  - holds the enabled registry plugins that provide `optionProperties`, `optionView` or
    `exposure`, and their declarations;
  - computes the viewer-visible effective values from `snapshot.properties`: shared values plus
    the viewer's own `person` values, never others' (FR-006);
  - calls `optionView` and `optionList` with caching per
    `(plugin, option, surface, values version)` and a 200 ms keep-previous rule;
  - validates with `validateContribution`, falling back with the notice "A plugin could not
    display here.";
  - exposes `setValue(s)` through an injected `appendProperties(entries)`, checking
    `checkPropertyValue` and FR-012 first;
  - applies the marker choice (`deci.optionView.markerPlugin`, else the first enabled plugin
    that replaces `marker`);
  - computes `exposureMs` across plugins and dispatches `onOptionExposed` batches at most once a
    second.
- [x] T020 [P] Create `apps/web/src/features/option-view/exposure-tracker.ts`: the pure
  `ExposureTracker` (research R5, data-model.md). T007 should pass.
- [x] T021 Create `apps/web/src/features/option-view/useExposure.ts`:
  - one shared `IntersectionObserver` (`root: null`, thresholds `[0, 0.5, 1]`);
  - `document.visibilitychange` and window `blur`/`focus` → `pageVisible`;
  - a 250 ms `tick` interval only while something is on screen;
  - returns `exposureRef(optionId)`;
  - is a no-op when no enabled plugin wants exposure.
- [x] T022 [P] Create `apps/web/src/features/option-view/OptionPlaces.tsx`:
  - components `OptionMarker`, `OptionBadges`, `OptionFooter`, `OptionSections`,
    `PropertySection` and `OptionListBar`, rendered from the provider's contributions with
    theme tokens;
  - the marker as an icon plus a visually hidden label (never colour alone);
  - the `dot` and `bold` variants also set the title's emphasis class;
  - Markdown through the app's existing sanitizing renderer;
  - action buttons with a busy state and a toast "<plugin name>: <message>" on error.
  
  Add static-markup tests in `apps/web/src/features/option-view/OptionPlaces.test.tsx`
  (`renderToStaticMarkup`), including the fallback notice.
- [x] T023 `apps/web/src/features/grading/OptionRow.tsx`:
  - on the card: render `OptionMarker`, `OptionBadges` (next to the number badge and title) and
    `OptionFooter`, and attach `exposureRef(option.id)` to the `<li>`;
  - in `OptionLightbox`:
    - the marker and badges in the header row;
    - `PropertySection`, then `OptionSections`, just before the Discussion block;
    - `OptionFooter` in the footer;
    - `exposureRef` on the dialog content.
  - The title, `GradeInput` and comments stay untouched (FR-022).
- [x] T024 [P] Attach `exposureRef(option.id)` to option rows in
  `apps/web/src/features/voting/RankBallot.tsx` (`SortableOptionItem`) and
  `apps/web/src/features/voting/ResultsView.tsx`.
- [x] T025 `apps/web/src/app/ProjectViewPage.tsx`:
  - wrap the page in `OptionExtensionsProvider` with `viewerId = currentUser` and
    `appendProperties = (entries) => store.append(ref, entries)`, with an optimistic snapshot
    update like grades;
  - render `OptionListBar` (summary and filter toggles) above `<ul aria-label="Options">`;
  - apply the active filter to active options only.
  
  Also wrap `ProjectVotePage` and `ProjectResultsPage` in `apps/web/src/app/pages.tsx`, so
  ballot and results exposure counts.

**Checkpoint**: the kit is green for 5 stores, the host renders nothing new (no plugins
enabled), and existing e2e tests pass unchanged.

---

## Phase 3: User Story 1 — See which options I have not looked at yet (P1) 🎯 MVP

**Goal**: unseen options look like unread mail; an option is marked "Seen" after 5 s on screen;
a count and an "Only not seen" filter; marks are private, including for live guests.

**Independent Test**: spec US1 (12 options; 3 kept 6 s → "Seen"; 4–6 scrolled fast → new;
"9 not seen yet"; the filter lists 4–12).

- [x] T026 [P] [US1] Write `plugins/option-status/test/option-status.test.ts` against
  data-model.md "Personal option status":
  - transitions:
    - none → `seen_auto` on exposure;
    - "Mark as seen" → `seen`;
    - "Mark as not seen" → `not_seen`, with no auto re-mark in the same plugin instance and an
      auto re-mark in a new instance;
  - the marker `{ variant: "dot", label: "Not seen", tone: "primary", replace: true }` only for
    none / `not_seen`;
  - footer actions;
  - the summary "N not seen yet" over active options, hidden at 0;
  - the filter `where: { key: "seen", in: [null, "not_seen"] }`;
  - `exposureMs` = `seconds × 1000`, and `null` when `autoMark` is false.
- [x] T027 [US1] Write `plugins/option-status/decisionator-plugin.json`:
  - id `org.decisionator.option-status`, name "Option status";
  - `provides.optionProperties`:
    `[{ key: "seen", label: "Seen", type: "choice", scope: "person", hidden: true,
       choices: seen | seen_auto | not_seen }]`;
  - `provides.optionView { places: ["marker","footer","list"], replaces: ["marker"] }`;
  - `provides.exposure: true`;
  - `settingsSchema`: `autoMark` (boolean, default `true`) and `seconds` (integer, 1–300,
    default 5).
- [x] T028 [US1] Implement `plugins/option-status/src/index.ts`: the `PluginDefinition` with
  `optionView`, `optionList`, `onOptionAction` (`mark-seen`, `mark-not-seen`),
  `onOptionExposed` (batch `setValues` to `seen_auto`, skipping options manually set to
  `not_seen` in this instance) and `exposureMs`. T026 should pass.
- [x] T029 [US1] Register the built-in: add the manifest to `BUILTIN_MANIFESTS` in
  `apps/web/src/features/plugins/plugin-registry.ts` (enabled by default), and the definition to
  `apps/web/src/features/option-view/builtins.ts`.
- [x] T030 [P] [US1] Write the live-share tests first, in
  `plugins/share-inpage/test/host-guest.test.ts`:
  - a guest `property` (`scope: "person"`) is accepted and recorded under the guest;
  - `scope: "shared"` → `invalid` "That change is not allowed.";
  - a removed option → `invalid`;
  - `value` over 2 KiB → `invalid`;
  - another guest's snapshot contains the shared values but not the first guest's `person`
    values;
  - the owner's own `person` values never reach guests;
  - a v2 `hello` → `protocol_mismatch`.
- [x] T031 [US1] Implement the live-share part:
  - `plugins/share-inpage/src/protocol.ts`: `PROTOCOL_VERSION = 3` and the `property` member of
    `GuestEntrySchema`;
  - `src/policy.ts`: an explicit `property` branch in `checkSubmission` (no more falling into
    the ranking `else`), and `properties` filtered in `redactSnapshotFor` to shared values plus
    `by === participantId`;
  - `specs/004-live-share-network/contracts/live-share.md` → 3.0.0, with a changelog row and a
    changeset.
  
  T030 should pass.
- [x] T032 [US1] `apps/web/src/features/live/GuestSession.tsx`:
  - wrap `GuestWorkspace` in `OptionExtensionsProvider` with `viewerId = me`;
  - `appendProperties` queues entries and flushes them through `guest.submit` at most every 2 s
    (≤ 50 per submit);
  - on refusal, drop the optimistic values and show the existing "Not saved" toast once per
    flush.
- [x] T033 [US1] Write `apps/web/e2e/option-status.spec.ts` (local store, status seconds set to
  1 through localStorage, except one test kept at the 5 s default):
  - every card shows "Not seen" and the header says "12 not seen yet";
  - keeping cards on screen marks them, and the count drops;
  - fast scroll keeps cards new;
  - "Only not seen" lists exactly the new ones and drops one when it becomes seen;
  - "Mark as not seen" stays new during the visit and is re-marked after a reload;
  - marks persist across a reload;
  - a live guest (second page, own device secret) gets marks, the host's view does not change,
    and the host's own marks never appear for the guest;
  - `checkA11y` on the card list and the lightbox.

**Checkpoint**: US1 is fully usable with defaults (MVP).

---

## Phase 4: User Story 2 — Decide how and whether options are marked (P2)

**Goal**: Settings → Options holds the time (1–300 s) and switches automatic marking off and on.

**Independent Test**: spec US2 (10 s: 7 s stays new, 10 s marks; off: nothing auto-marked,
manual still works).

- [x] T034 [US2] Create `apps/web/src/features/settings/OptionSettings.tsx` and render it as an
  "Options" card in `SettingsPage` (`apps/web/src/app/pages.tsx`):
  - the status plugin's settings form (reuse `PluginSettings`, saved with `updatePlugin`);
  - a value outside the range shows "The time must be between 1 and 300 seconds." and keeps
    the previous value;
  - the card is hidden when the plugin is disabled.
- [x] T035 [US2] In `OptionExtensionsProvider.tsx`, re-read plugin settings on registry
  `subscribe` notifications, and push the new `exposureMs` into the tracker
  (`setMinMs`, or stop when `null`) without a reload. Previously recorded marks are untouched
  (US2 scenario 6).
- [x] T036 [US2] Add tests to `apps/web/e2e/option-status.spec.ts`:
  - the default shows on and 5 s;
  - 10 s: 7 s stays new, 10 s marks;
  - 0 and 400 are refused with the message;
  - off: kept on screen for 3 × the time, nothing is marked, and "Mark as seen" works;
  - back on keeps existing marks;
  - `checkA11y` on Settings.

---

## Phase 5: User Story 3 — Plugins add their own properties to options (P2)

**Goal**: any plugin declares typed shared or per-person properties that are shown, checked,
exported, restored and kept when the plugin is disabled.

**Independent Test**: spec US3 (the example "Cost per person" = 420 is visible to everyone,
survives export → restore, and is hidden while disabled but kept).

- [x] T037 [P] [US3] Implement `examples/plugin-option-cost/`:
  - the manifest declares `cost` ("Cost per person", `number`, `shared`, `cardBadge: true`),
    `shortlisted` ("Shortlisted", `boolean`, `person`) and `priority` ("Priority", `choice`
    low/high, `shared`);
  - `optionView` adds a detail section "Budget" with `fields`;
  - tests in `examples/plugin-option-cost/test/plugin.test.ts`.
  
  Also implement `examples/plugin-unread-bar/` with its own `person` property and exposure, and
  `replaces: ["marker"]` with `variant: "bar"`, `tone: "info"` (used by US4), with tests.
- [x] T038 [US3] Create `apps/web/src/features/option-view/dev-plugins.ts`. It registers the two
  example plugins as installable entries only when `import.meta.env.DEV` and localStorage
  `deci.devPlugins` lists their ids, so they are never in production builds. A second fixture
  plugin defining `priority` under another id is used for the same-name case.
- [x] T039 [US3] Finish `PropertySection` in `OptionPlaces.tsx`:
  - inputs per type (text, number, switch, select, date);
  - editable only where FR-012 allows (shared: owner; person: self), read-only display
    otherwise;
  - each plugin's properties labelled with the plugin name when two plugins share a key;
  - the validation message from `checkPropertyValue` and nothing saved on failure;
  - "Invalid value" shown to editors for a stored value that fails its declaration, ignored
    elsewhere;
  - `cardBadge` values added to `OptionBadges`.
  
  Extend `OptionPlaces.test.tsx`.
- [x] T040 [P] [US3] Export:
  - `packages/core/src/export/project-v1.ts`: `properties` (optional, default `[]`), with
    `packages/core/schema/project-export-v1.schema.json` mirrored;
  - `packages/core/src/export/project-xlsx.ts`: a "Properties" sheet with columns Option,
    Plugin, Key, Scope, Value, By, By name, At, Record (JSON) in `createProjectWorkbook` and
    `readProjectWorkbook`;
  - round-trip tests in `packages/core/test/`;
  - update `docs/project-export.md`.
- [x] T041 [US3] Restore and Move:
  - `apps/web/src/features/project/copy-entries.ts`: `EntriesToCopy.properties`; re-append
    `person` values grouped by `by` with `onBehalfOf`, and `shared` values as the signed-in
    owner;
  - `apps/web/src/features/project/project-file.ts`: include `properties` in
    `snapshotToExport`;
  - extend `copy-entries.test.ts` and `project-file.test.ts` (JSON and xlsx), including a guest
    `seen` mark restored under the guest.
- [x] T042 [P] [US3] Agent API in `packages/node/src/agent-api/`:
  - `state.ts`: declarations and shared values;
  - `rest.ts`:
    - `GET /context` adds `optionProperties` and shared `properties`;
    - `PUT /options/{optionId}/properties/{plugin}/{key}`: `400` with the validation message,
      `403` for `person`, attributed to the agent;
  - `mcp.ts`: `get_option_properties` and `set_option_property`;
  - `schemas.ts`.
  
  Write tests first in `packages/node/test/contract/agentic-api.test.ts`. Update
  `specs/001-decision-engine-core/contracts/agentic-api.md` (minor bump) and add a changeset.
- [x] T043 [US3] Write `apps/web/e2e/option-properties.spec.ts` (dev plugins enabled through
  localStorage):
  - the owner sets "Cost per person" to 420, and "abc" is refused with "enter a number";
  - a live guest sees "Cost per person: 420" read-only;
  - "Shortlisted" is per person;
  - two "Priority" properties are shown with plugin labels;
  - export JSON and xlsx → restore keeps 420;
  - disabling the plugin hides the value, and re-enabling shows it again;
  - disabling "Option status" removes the marks, count and filter while grading works
    (US3 scenario 9);
  - `checkA11y` on the lightbox with properties.

---

## Phase 6: User Story 4 — Plugins change how options look (P2)

**Goal**: plugins add to and replace the fixed places; core controls are protected; marker
conflicts are resolved in Settings; failures fall back.

**Independent Test**: spec US4 (the "unread bar" plugin replaces the dot with a blue bar, and the
cost plugin adds a "€420" badge; grading, commenting and voting are unchanged; disabling brings
the dot back).

- [x] T044 [US4] Add a "Marker style" chooser to `OptionSettings.tsx`. It lists the enabled
  plugins that replace `marker`, is stored in `deci.optionView.markerPlugin`, and is shown only
  when two or more plugins compete. The provider applies the choice live.
- [x] T045 [P] [US4] Add provider unit tests in
  `apps/web/src/features/option-view/OptionExtensionsProvider.test.tsx`
  (`renderToStaticMarkup` with a fake registry):
  - the marker choice versus first-enabled;
  - badges, footer and sections in plugin order;
  - a throwing hook falls back with the notice and other places still render;
  - a contribution that names `title`, `grade` or `comments` is ignored (it is not in the
    schema);
  - disabling removes contributions on the next render.
- [x] T046 [US4] Add tests to `apps/web/e2e/option-properties.spec.ts`:
  - with "unread bar" enabled, unseen cards show the bar instead of the dot, on the card and in
    the lightbox;
  - with both marker plugins enabled, Settings switches between them;
  - the "€420" badge appears on the card and in the lightbox header;
  - grade, comment and ballot on "Lisbon" work as before;
  - disabling restores the dot with no reload;
  - a dev fixture plugin that throws shows "A plugin could not display here." and the card
    still grades.

---

## Phase 7: User Story 5 — See when things happened (P2)

**Goal**: history is kept for grades, ballots and properties, and times are shown in tooltips.

**Independent Test**: spec US5 (a re-grade from 3 to 4 shows its time and "Changed from 3"; the
seen action shows "Seen automatically · time").

- [x] T051 [P] [US5] Write `packages/core/test/history.test.ts` for `effectiveEntries`, per
  data-model.md "Reset" and contracts/history-resets.md:
  - latest wins per slot, and superseded entries go to `history` oldest first;
  - a participant reset clears only that participant's entries appended earlier;
  - an all-scope reset with `round: 1` leaves round-2 ballots;
  - an all-scope reset clears only `shared` properties;
  - a reset never clears entries appended after it;
  - the `plugin`/`key` limits apply.
- [x] T052 [US5] Create `packages/core/src/model/history.ts`:
  - `ResetSchema` with these rules: targets are 1–3 unique values; `participantId` is required
    if and only if the scope is `participant`; `plugin` and `key` come together; `round` ≥ 1;
  - `effectiveEntries({ grades, rankings, properties, resets })` returning
    `{ grades, rankings, properties, history }`.
  
  Export it from `packages/core/src/index.ts`. In `packages/plugin-sdk/src/project-store.ts`, add
  the `reset` member to `Entry` and `history?` to `ProjectSnapshot`.
  `packages/plugin-sdk/src/delegation.ts` allows `reset` only in the self form, and
  `packages/plugin-sdk/src/property-entries.ts` gets `checkResetEntries(entries, { isOwner, self })`.
  T051 should pass.
- [x] T053 [US5] Add the contract-kit cases from contracts/history-resets.md ("Contract-kit
  cases") to `packages/plugin-sdk/testing/project-store-kit.ts`, under the describe
  "history and resets (v1.4.0)". They fail first.
- [x] T054 [P] [US5] `plugins/store-file/src/file-store.ts`:
  - append grades, rankings and properties instead of replacing them;
  - store resets;
  - build the snapshot with `effectiveEntries`, including `history`.
- [x] T055 [P] [US5] `plugins/store-local/src/store.ts`: the same as T054 for Automerge, never
  storing `undefined`.
- [x] T056 [P] [US5] `plugins/store-firestore/src/{collections,firestore-store}.ts`: a `reset`
  entry doc; `buildEntries` uses `effectiveEntries` and returns `history`.
- [x] T057 [P] [US5] Google Sheets:
  - `plugins/store-google-sheets/src/layout.ts`: tab `resets[id,at,by,payload]`, added in the
    same 2.3.0 migration;
  - `src/rows.ts`: `decodeResetRow`;
  - `src/sheet-store.ts`: `effectiveEntries` over row order, and `history`;
  - update `specs/001-decision-engine-core/contracts/sheet-store.md`.
- [x] T058 [P] [US5] `examples/plugin-store-memory/src/index.ts`: append plus
  `effectiveEntries`. Add the rules from contracts/history-resets.md to
  `specs/001-decision-engine-core/contracts/project-store.md` (1.4.0).
- [x] T059 [US5] Live share:
  - `plugins/share-inpage/src/policy.ts`: `redactSnapshotFor` passes `history` filtered to the
    guest's own grades, rankings and properties, plus resets with `scope: "all"` or that target
    the guest;
  - tests in `plugins/share-inpage/test/host-guest.test.ts`;
  - update `specs/004-live-share-network/contracts/live-share.md` (3.0.0).
- [x] T060 [P] [US5] Export:
  - `packages/core/src/export/project-v1.ts`: optional `history` and `resets` (default empty),
    mirrored in the JSON schema;
  - `project-xlsx.ts`: "History" and "Resets" sheets;
  - round-trip tests in `packages/core/test/export/`;
  - update `docs/project-export.md`.
- [x] T061 [US5] `apps/web/src/features/project/copy-entries.ts`: restore and Move re-append the
  history in its original order (per author, through `onBehalfOf`), then the effective entries and
  resets. Extend `copy-entries.test.ts` and `project-file.test.ts`.
- [x] T062 [P] [US5] Create `apps/web/src/features/history/time-texts.ts`:
  - pure functions for the texts in data-model.md "Tooltip texts";
  - `Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })`, with an
    injectable locale and time zone;
  - tests in `time-texts.test.ts`.
- [x] T063 [US5] Create `apps/web/src/features/history/TimeTooltip.tsx`:
  - built on the Radix tooltip, on an existing focusable trigger, so it opens on hover and focus;
  - a 500 ms touch long-press also opens it;
  - the same text is set as `aria-describedby`.
  
  Use it on the own stars (card and lightbox in `OptionRow.tsx`), on the average, and on
  "Submit/Update Ballot" in `apps/web/src/features/voting/RankBallot.tsx`.
- [x] T064 [US5] In `OptionLightbox` (`OptionRow.tsx`), add an owner-only "Ratings" disclosure
  listing `{name} {v} · {time}` from the effective grades. Pass `isOwner` and the option's
  grades into `OptionRow`.
- [x] T065 [US5] Seen-status tooltip:
  - `packages/plugin-sdk/src/option-view.ts`: footer actions gain `title` (≤ 120 chars), shown by
    `OptionPlaces.tsx` in a `TimeTooltip`;
  - `OptionViewContext` gains `valueMeta: Record<key, { at, by }>` for the viewer's own
    effective values;
  - `plugins/option-status/src/index.ts` sets "Seen automatically · {time}", "Marked as seen ·
    {time}" and "Marked as not seen · {time}". Add tests.

---

## Phase 8: User Story 6 — Start over: reset votes and seen status (P2)

**Goal**: the owner resets all votes or one participant's, and clears shared properties. Each
person resets their own seen marks. Resets are recorded; nothing is deleted.

**Independent Test**: spec US6 (resetting Tom keeps the owner's and Gina's grades; Gina's "Mark
all as not seen" changes only her marks).

- [x] T066 [US6] Create `apps/web/src/features/history/ResetDialog.tsx` (owner only), opened from
  "More project actions" → "Reset…" in `apps/web/src/app/ProjectViewPage.tsx`:
  - a choice between "All votes" and one participant, listed from the grade, ballot and history
    authors with `byName`;
  - shared plugin properties to clear;
  - a confirmation with counts, for example "Clear 12 grades and 1 ballot from Tom?";
  - one `reset` entry appended per choice;
  - toasts for the result.
- [x] T067 [US6] List actions for plugins:
  - in `packages/plugin-sdk/src/option-view.ts`, `OptionListContribution.actions` (≤ 2,
    `{ id, label, confirm }`) and an `onListAction(ctx, id)` hook;
  - `OptionListContext.resetValues(key)`;
  - the host in `OptionExtensionsProvider.tsx` appends
    `{ kind: "reset", scope: "participant", participantId: viewer, targets: ["properties"], plugin, key }`
    for a person-scoped key, or `scope: "all"` for a shared key (owner only);
  - `OptionListBar` shows each action, with its `confirm` text in a dialog.
- [x] T068 [US6] `plugins/option-status/src/index.ts`: a list action "Mark all as not seen", with
  the confirm text "Show every option as new again? Only your own marks change.". It calls
  `resetValues("seen")` and clears the manual hold. Add tests.
- [x] T069 [US6] Live share:
  - `plugins/share-inpage/src/protocol.ts`: a guest `reset` entry (self form);
  - `src/policy.ts`: force `participantId` to the guest and accept only
    `targets: ["properties"]` with `plugin` and `key`;
  - tests: a guest self reset is accepted; any other reset → `invalid`; an owner reset reaches
    guests through the broadcast;
  - `apps/web/src/features/live/GuestSession.tsx` sends list resets through the existing batching.
- [x] T070 [US6] Write e2e `apps/web/e2e/history-reset.spec.ts`:
  - the owner plus two live guests, each with their own device secret;
  - the owner resets Tom, and the averages update for everyone within 1 s;
  - "Reset all votes" for round 1;
  - an earlier outcome still verifies ("Verify Outcome" → "Reproduced ✓");
  - Gina's "Mark all as not seen";
  - the US5 tooltip texts, by hover and keyboard focus;
  - `checkA11y` on the Reset dialog.

---

## Phase 9: User Story 7 — Choose how this project is decided (P2)

**Goal**: the project stores its strategy, participants see it, and closing the vote uses it.

**Independent Test**: spec US7 ("Weighted grades" is chosen and "Decided by: Weighted grades" is
shown; the outcome names Weighted grades).

- [x] T071 [US7] Start with contract-kit cases "strategy meta (v1.4.0)" in
  `packages/plugin-sdk/testing/project-store-kit.ts`:
  - an owner set returns `snapshot.project.strategy` with `at`/`by`;
  - `strategyChanges` is capped at 20;
  - a non-owner change → `PERMISSION_DENIED`;
  - it round-trips in password mode.
  
  Then implement:
  - `strategy` and `strategyChanges` in `packages/core/src/model/project.ts`;
  - `MetaPatch.strategy` in `packages/plugin-sdk/src/project-store.ts`;
  - `updateMeta` and the read path in all five stores (Sheets meta keys `strategy` and
    `strategyChanges`).
- [x] T072 [US7] Create `apps/web/src/features/decide/strategies.ts`:
  - move `BUILTIN_STRATEGIES` and the descriptors out of `StrategyChooser.tsx`;
  - `enabledStrategies()`;
  - `chosenStrategy(snapshot)`, falling back to Borda with `{ topN: voting.topN }`;
  - `strategyName(id)`;
  - tests in `strategies.test.ts`.
- [x] T073 [US7] Add an owner-only "Decision method" picker to `ProjectVotePage`
  (`apps/web/src/app/pages.tsx`), with the strategy settings form:
  - while voting is open with ballots, warn "{n} people have already voted. Changing the method
    now may change the result.";
  - save with `store.updateMeta(ref, { strategy })`.
- [x] T074 [US7] Show "Decided by: {name}" with the one-line description on the vote page, in
  `apps/web/src/features/live/GuestSession.tsx` and in `ResultsView.tsx`.
- [x] T075 [US7] `handleCloseAndTally` in `apps/web/src/app/pages.tsx`:
  - use `chosenStrategy`;
  - when the strategy is unavailable, show "{name} is not available. Choose another method
    before closing the vote.";
  - when `check()` fails, show its reason;
  - in both cases voting stays open.
  
  Write e2e `apps/web/e2e/strategy.spec.ts` for the US7 scenarios.

---

## Phase 10: User Story 8 — Compare what each strategy would decide (P3)

**Goal**: a side-by-side, reproducible preview of every enabled strategy, with Adopt.

**Independent Test**: spec US8 (a row per strategy, differences marked, the same random draw on
reopening, and Adopt records exactly one outcome).

- [x] T076 [P] [US8] Write `apps/web/src/features/decide/compare.test.ts`, then
  `compare.ts`'s `compareStrategies(snapshot, strategies, chosenId)`:
  - the seed is `hex(SHA-256(canonical tally input))[0..32]`;
  - each row is `{ ok, order, winner, seed }` or `{ ok: false, reason }`;
  - `differsFromChosen`;
  - a repeated call gives the same seed;
  - an unrunnable strategy gives its `check()` reason.
- [x] T077 [US8] Create `apps/web/src/features/decide/CompareStrategiesDialog.tsx`:
  - a table with Strategy, Winner, Top 3, and Seed or Reason;
  - the text "Winner differs from the chosen method";
  - an owner-only "Adopt" that appends the reproduced outcome through the existing
    StrategyChooser append path;
  - opened from Results: always for the owner; read-only for others (including the guest view)
    when `liveResults` is on or voting is closed.
- [x] T078 [US8] Add e2e tests to `apps/web/e2e/strategy.spec.ts`:
  - 4 strategy rows;
  - the same random seed when reopened;
  - Adopt adds exactly one outcome, and it verifies;
  - read-only for a guest with live results on;
  - hidden while live results are off and voting is open;
  - `checkA11y` on the dialog.

---

## Phase 11: Polish & Cross-Cutting

- [x] T047 [P] Document both extension points in `docs/plugin-authors.md`: declaring properties,
  view places, exposure, the examples, and the limits (≤ 3 badges, sections in the detail view
  only, no core controls).
- [x] T048 [P] Update `CLAUDE.md` (Tech stack: `plugins/option-status`, the option-view host and
  the new contracts), and `specs/001-decision-engine-core/data-model.md` (option status also
  includes `proposed`; the new `PropertyValue`).
- [x] T049 Performance check for SC-003: add a Playwright test in
  `apps/web/e2e/option-status.spec.ts` with 100 options and the status plugin on. Scroll the
  whole list with CPU throttling 4× (Chromium only) and assert that no long task over 200 ms
  occurs (PerformanceObserver `longtask`) and that a grade shows within 1 s.
- [ ] T050 Run the full validation from [quickstart.md](./quickstart.md):
  - `pnpm vitest run`;
  - `pnpm -r typecheck`;
  - `pnpm exec biome check .`;
  - the new e2e specs on Chromium, Firefox and WebKit;
  - `apps/web/e2e/live-session.spec.ts`, `a11y.spec.ts` and `export-restore.spec.ts` for
    regressions.
  
  Fix any failures.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T025)** → user stories.
- Within Foundational:
  - T004–T007 (tests) first;
  - T008 → T009 → T012–T016 (stores, in parallel);
  - T010 → T011;
  - T018 → T019;
  - T020 → T021;
  - T022 → T023 → T024 → T025;
  - T017 any time after T009.
- **US1 (T026–T033)** needs Foundational. T030 → T031 → T032. T033 last.
- **US2 (T034–T036)** needs T028 (the status plugin's settings).
- **US3 (T037–T043)** needs Foundational only; it does not need US1. T040 → T041.
- **US4 (T044–T046)** needs T037 (example plugins) and T028 (the default marker to replace).
- **US5 (T051–T065)** needs Foundational:
  - T051 → T052 → T053;
  - then the stores T054–T058 in parallel;
  - then T059–T061;
  - T062 → T063 → T064;
  - T065 needs T028.
- **US6 (T066–T070)** needs US5 (reset entries and history).
- **US7 (T071–T075)** needs Foundational only. T071 → T072 → T073–T075.
- **US8 (T076–T078)** needs T072.
- **Polish** comes last.

## Parallel Examples

- Foundational tests: T004, T006 and T007 together. Then the stores T012, T013, T014, T015 and
  T016 together once T009 lands.
- US1: T026 and T030 together (different packages).
- US3: T037, T040 and T042 together (examples, core export, node agent API).

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1 gives the "Seen" status with defaults, private marks and
   live guests. Stop and validate with the US1 independent test.
2. Then add US2 (settings), US3 (third-party properties, export and restore, agent API) and US4
   (view replacement and conflict choice), in that order. Each is shippable on its own after
   its checkpoint.
3. Commit after each task group, with Conventional Commits and a changeset for every bumped
   contract.
