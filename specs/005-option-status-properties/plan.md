# Implementation Plan: Personal Option Status and Plugin-Defined Option Properties

**Branch**: `005-option-status-properties` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-option-status-properties/spec.md`

## Summary

Add two public plugin extension points, both versioned contracts:

- **Option properties**: manifest-declared, typed values stored as a new append-only `property`
  entry, shared or per person.
- **Option view**: declarative contributions to fixed places on the option card, the detail
  view and the option list, plus an exposure signal that says when an option has been on
  screen for N ms.

Then ship the personal "Seen" status as a built-in plugin, `org.decisionator.option-status`,
that uses only those two interfaces. The plugin registry's `enabled` flag becomes effective, so
disabling the plugin removes the feature (FR-018). Storage, live share, export, restore, Move
and the agent API all carry the new entry. Per-person values are shown only to their author.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict, ESM), Node.js 24 for tooling

**Primary Dependencies**:

- zod 3 for contribution and entry validation;
- React 19 for the web app, with Radix, lucide-react and the existing rjsf `PluginSettings`;
- `IntersectionObserver` and the Page Visibility API (browser built-ins).

No new runtime dependencies.

**Storage**:

| Store | Change |
|---|---|
| store-file (IndexedDB / file) | new `properties` array |
| store-local (Automerge) | new `properties` list |
| store-firestore | new entry kind |
| store-google-sheets | new `properties` tab (layout 2.3.0, with migration) |

Exports gain JSON `properties[]` and an xlsx "Properties" sheet.

**Testing**:

- Vitest in Node: contract kits, pure trackers, `renderToStaticMarkup`.
- Playwright on Chromium, Firefox and WebKit, with axe.

**Target Platform**: evergreen browsers (GitHub Pages SPA); `packages/node` for the agent API.

**Project Type**: pnpm monorepo, with a web app, packages and first-party plugins.

**Performance Goals**: SC-001 (marked within 1 s after the threshold); SC-003 (smooth scrolling
with 100 cards on a mid-range phone, and a grade still visible within 1 s).

**Constraints**:

- Google Sheets quota budget: ≤ 20 writes per minute per client, so marks are batched per flush.
- Live-share rate limit: 20 burst, 5/s, so guest marks are batched every 2 s.
- The sandbox model: plugins never inject markup.

**Scale/Scope**: up to 200 options per project, 64 live guests, about 20 declared properties per
plugin.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Evaluation | Status |
|-----------|------------|:------:|
| I. Minimal core, modules | "Seen" lives entirely in a built-in plugin that uses only the new public hooks. The core gains only generic properties, view places and exposure. Disabling the plugin removes the feature (FR-018). The example cost plugin proves third-party parity. | PASS |
| II. Versioned contracts | New contracts `option-properties` 1.0.0 and `option-view` 1.0.0. Bumps: ProjectStore 1.3.0 → 1.4.0 (additive), sheet layout 2.2.0 → 2.3.0 (migration), live-share 2.1.0 → 3.0.0 (proto 3, with the plain mismatch message), manifest schema (new optional `provides` keys, `platform.optionProperties`/`optionView`), plugin runtime minor, agentic API minor. Each comes with a changeset. | PASS |
| III. Simple by default | Works with no setup (5 s default). Settings are optional, in Settings → Options. Plugins reach only fixed places; title, grading, comments and ballot cannot be touched (FR-022). | PASS |
| IV. Agent-native | Shared properties are readable and writable through REST and MCP, with attribution. Per-person marks are personal data, not an agent capability; the spec scopes agents to shared values (FR-017). | PASS |
| V. User owns the data | Marks are visible only to their author in the product, redacted for live guests, and automatic marking can be switched off. Exports include all values (the owner's data). The Sheets backend's raw-sheet visibility is documented (research R2). | PASS |
| VI. Reproducible, append-only | Properties are append-only entries with latest-wins, and they never feed strategies or outcomes (FR-007). | PASS |
| VII. Test-first for contracts | Contract-kit property cases and share-inpage protocol tests are written before the store and host changes. Exposure timing is a pure, fake-clock-tested class. | PASS |
| Dependencies | none added | PASS |
| Accessibility | Host-rendered places only, markers not colour-only, axe in e2e for the card, lightbox and Settings (FR-025). | PASS |

Re-check after Phase 1: unchanged, all PASS.

## Project Structure

### Documentation (this feature)

```text
specs/005-option-status-properties/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── option-properties.md
│   └── option-view.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
  model/property.ts               PropertyValue, OptionPropertyDefinition schemas, checkPropertyValue
  export/project-v1.ts            + properties[] (optional)
  export/project-xlsx.ts          + "Properties" sheet
packages/plugin-sdk/src/
  project-store.ts                + Entry "property", snapshot.properties
  delegation.ts                   + property (person scope only)
  runtime.ts                      + optionView / optionList / onOptionAction / onOptionExposed / exposureMs
  option-view.ts                  contribution schemas + validateContribution
packages/plugin-sdk/testing/project-store-kit.ts   + property cases
plugins/store-file | store-local | store-firestore | store-google-sheets   + property support
examples/plugin-store-memory      + property support
examples/plugin-option-cost       sample third-party-style plugin (shared number, card badge, section)
plugins/option-status/            NEW built-in: manifest, definition (view, list, exposure), tests
plugins/share-inpage/src          protocol v3 property entry, policy + redaction
packages/node/src/agent-api       context properties, PUT property, MCP tools
apps/web/src/
  features/plugins/plugin-registry.ts   subscribe(), merge new built-ins
  features/option-view/
    OptionExtensionsProvider.tsx        enabled plugins, values per viewer, hook calls + cache
    exposure-tracker.ts                 pure ExposureTracker
    useExposure.ts                      IntersectionObserver + visibility adapter
    OptionPlaces.tsx                    Marker, Badges, Footer, Sections, PropertySection, ListBar
  features/grading/OptionRow.tsx        places on card + lightbox, exposureRef
  features/voting/RankBallot.tsx, ResultsView.tsx   exposureRef on option rows
  app/ProjectViewPage.tsx               list summary/filters, property appends
  features/live/GuestSession.tsx        same, via guest.submit batching
  app/pages.tsx (SettingsPage)          Options card (status settings + marker choice)
  features/project/copy-entries.ts, project-file.ts   properties in restore/Move/export
specs/001-decision-engine-core/contracts/ project-store.md, sheet-store.md, plugin-manifest.schema.json,
                                         plugin-runtime.md, agentic-api.md   version bumps
specs/004-live-share-network/contracts/live-share.md   3.0.0
```

**Structure Decision**: follow the existing monorepo layout. The new built-in is a plugin
package (`plugins/option-status`), like the strategies. Generic host code lives in
`apps/web/src/features/option-view`.

## Implementation phases

1. **Contracts and core**:
   - property schemas and `checkPropertyValue`;
   - the Entry union and delegation;
   - contract-kit cases (failing);
   - contract docs and version bumps.
2. **Stores**: file, local, firestore, sheets (tab and migration), memory example, until the
   kit is green.
3. **Host**:
   - registry subscribe and merge;
   - `OptionExtensionsProvider`;
   - contribution validation;
   - places on the card and lightbox;
   - list bar;
   - `ExposureTracker` and `useExposure`;
   - Settings → Options.
4. **Status plugin**: definition and tests, registered as a built-in. Verifies US1 and US2.
5. **Example cost plugin**: shared property, badge and section. Verifies US3 and US4.
6. **Live share**: proto 3 property entry, policy, redaction and guest batching (FR-009).
7. **Export, restore and Move**: JSON, xlsx and copy-entries (FR-015).
8. **Agent API**: context, PUT and MCP (FR-017).
9. **E2E, accessibility, docs** (`docs/plugin-authors.md`) and changesets.

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|------|-----|--------------------------------------|
| Declarative view contributions instead of plugin components | Sandboxed plugins cannot render into the host DOM; 100 iframes are not workable | In-process components would make built-ins privileged (Constitution I) |
| Host-owned exposure tracking | A plugin cannot observe the host DOM | Plugin polling is impossible from the sandbox |
| Live-share proto 3 | An old host would refuse every mark with "invalid" | Silent incompatibility would show endless "Not saved" toasts |
| New Sheets tab with migration | One payload column per tab keeps the row shape uniform and batched | Reusing an existing tab would overload its decoder and its latest-wins rule |
