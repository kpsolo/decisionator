---
description: "Task list for 001-decision-engine-core (Deci)"
---

# Tasks: Decision Engine Core (Deci)

**Input**: Design documents from `/specs/001-decision-engine-core/`.
- plan.md (structure, increments)
- spec.md (US1–US7, FR, SC)
- research.md (R18–R28 for the MVP)
- data-model.md
- contracts/
- quickstart.md

**Tests**: Included. Constitution Principle VII requires test-first for plugin contracts,
strategies and the agent API. The quickstart defines E2E scenarios per story. Test tasks come
before their implementation, and their tests must fail first.

**Organization**: Phases follow the delivery increments in plan.md. **The MVP = Phases 1–6
(US1–US3 + release).** US4–US7 phases are deliberately lighter; each starts with a planning
checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: US1–US7 from spec.md.
- Paths follow the plan:
  - `apps/web/`
  - `packages/core/`, `packages/plugin-sdk/`
  - `plugins/store-google-sheets/`, `plugins/source-paste/`, `plugins/strategy-borda/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: monorepo, tooling, CI and hosting skeleton.

- [x] T001 Create the pnpm workspace root (`package.json`, `pnpm-workspace.yaml`, `.nvmrc`):
  - `package.json` with `"packageManager": "pnpm@10"`, `"type": "module"` and scripts `lint`, `typecheck`, `test`, `test:contract`, `test:e2e`;
  - `pnpm-workspace.yaml` listing `apps/*`, `packages/*`, `plugins/*`;
  - `.nvmrc` with `24`.
- [x] T002 [P] Create `tsconfig.base.json`: `strict: true`, `module`/`target` `ES2022`, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`.
- [x] T003 [P] Create `biome.json`: formatter (2-space indent, 100-column line width), recommended lint rules, ignoring `dist/` and `coverage/`.
- [x] T004 [P] Initialize Changesets in `.changeset/config.json`: fixed versioning off; `apps/web` set private.
- [x] T005 Scaffold `packages/core/` and `packages/plugin-sdk/`:
  - each with `package.json`, `tsconfig.json`, `src/index.ts`, `vitest.config.ts`;
  - npm scope `@decisionator/*`;
  - `plugin-sdk` exports `.` and `./testing` subpaths.
- [x] T006 Scaffold `plugins/store-google-sheets/`, `plugins/source-paste/` and `plugins/strategy-borda/`:
  - each with `package.json`, `tsconfig.json`, `src/index.ts`, `test/`;
  - each with `decisionator-plugin.json` (manifest per `contracts/plugin-manifest.schema.json` v1.1, with `platform.runtime: "^1.0.0"`); the store's manifest follows `packages/core/test/fixtures/store-google-sheets.manifest.example.json` (`provides.projectStore`, `oauth.google.flow: "gis-token"`).
- [x] T007 Scaffold `apps/web/` with Vite and React 19 (TypeScript):
  - `vite.config.ts` with `base` from `VITE_BASE_URL` (default `/decisionator/`);
  - React Router in hash mode in `src/main.tsx`;
  - `.env.example` listing `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_BASE_URL`.
- [x] T008 [P] Create `.github/workflows/ci.yml`: install with pnpm and run lint, typecheck, `test`, `test:contract` and `test:e2e`, on `ubuntu-latest`, `windows-latest` and `macos-latest`.
- [x] T009 [P] Create `.github/workflows/pages.yml`: on push to `main`, build `apps/web` and deploy to GitHub Pages (`actions/deploy-pages`). Read Google IDs from repository variables. No server component (SC-009).
- [x] T010 [P] Create `apps/web/playwright.config.ts` (Chromium, Firefox, WebKit; two-context helper) and `apps/web/e2e/fixtures/axe.ts` wrapping `@axe-core/playwright` for WCAG 2.1 AA checks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: domain core, contracts, test kits, Google plumbing and the access spike. **No user
story work starts until this phase is done.**

### Contracts and test kits (write first)

- [x] T011 [P] Write `packages/core/test/rng.test.ts` with the frozen vectors from `contracts/strategy.md`:
  - seed `000102030405060708090a0b0c0d0e0f`: `nextUint32()`×3 = `2237479810, 1432266169, 209670291`, and `int(4)`×5 = `2, 1, 3, 2, 0`;
  - seed `ffffffffffffffffffffffffffffffff`: `int(10)`×5 = `3, 8, 9, 1, 4`, and `float()` = `0.060539633583655994`.
- [x] T012 [P] Create `packages/plugin-sdk/testing/vectors.json` with the same vectors (single source for third-party authors).
- [x] T013 Implement the normative SHA-256 counter-mode RNG in `packages/core/src/rng/index.ts`, using `@noble/hashes`:
  - `block(i) = SHA-256(seed ‖ uint32_be(i))`;
  - each block gives 8 big-endian words, consumed in order;
  - `int(n)` uses rejection sampling with `limit = floor(2^32 / n) * n`;
  - `float()` = `((a >>> 5) * 2^26 + (b >>> 6)) / 2^53`;
  - T011 must pass.
- [x] T014 [P] Define the Zod schemas `Project` and `Option` in `packages/core/src/model/project.ts` and `packages/core/src/model/option.ts`:
  - Project: `title` "1–200 chars"; `description` "≤ 20 000 chars"; `voting` `{state: "open"|"closed", round: int ≥ 1, topN: 1–10 (default 3), liveResults: bool}`; `formatVersion: 1`.
  - Option: `title` "1–200 chars; duplicates allowed, flagged"; `category` "≤ 60 chars"; `tags` "≤ 10, each ≤ 40 chars"; `pros`/`cons` "≤ 20 each"; `effort` `XS|S|M|L|XL`; `links` "≤ 10, http(s)"; `status` `active|removed`.
- [x] T015 [P] Define the Zod schemas `Grade`, `Comment` and `Ranking` in `packages/core/src/model/entries.ts`:
  - Grade: `value` 1–5.
  - Comment: `body` "1–10 000 chars", optional `replaces` and `hidden`.
  - Ranking: `ranking` "ordered, unique, active options, length 1..topN", plus `round`.
  - All carry `id` (ULID), `at` and `by`.
- [x] T016 [P] Define the Zod schema `OutcomeRecord` in `packages/core/src/model/outcome.ts` with fields `round?`, `strategy {id, version}`, `settings`, `inputs {options, ballots, grades}`, `result {winner, order[{optionId, points, firstPlaces}]}`, `tieBreak`, `seed?` (hex 32), `triggeredBy` and `at`.
- [x] T017 [P] Write model tests in `packages/core/test/model.test.ts` covering every boundary above (lengths, enum values, ballot uniqueness and length ≤ topN).
- [x] T018 Define the TypeScript contracts in `packages/plugin-sdk/src/`, exactly as specified in `contracts/project-store.md`, `contracts/idea-source.md` and `contracts/strategy.md`:
  - `project-store.ts`: `ProjectStore`, `Entry`, `ProjectSnapshot`, `ShareRequest`, `ShareState`, `AppendResult`;
  - `idea-source.ts`;
  - `strategy.ts`: `StrategyInput` including `grades?`, `StrategyResult`, `Rng`.
- [x] T019 Build the fake Google backend in `packages/plugin-sdk/testing/fake-google/` with Mock Service Worker:
  - an in-memory Drive (`files.create/get/list` with `appProperties` filter and `version` increments, `permissions.create/delete/list`, `about.get` per identity);
  - an in-memory Sheets (`spreadsheets.create`, `values.batchGet`, `values.append`, `values.batchUpdate`);
  - multiple signed-in identities with reader/writer/owner roles;
  - an injectable `429` / `403 rateLimitExceeded`.
- [x] T020 Implement `runProjectStoreContractTests(factory)` in `packages/plugin-sdk/testing/project-store-kit.ts`. Cases from `contracts/project-store.md`:
  - append-only behavior;
  - latest-wins for grades per (by, optionId) and rankings per (by, round);
  - author stamping (caller-supplied `by` is ignored);
  - access-level enforcement;
  - password round trip, and unreadability without the password;
  - `deleteProject` by the owner makes the project unavailable to everyone; a non-owner gets `PERMISSION_DENIED`;
  - queue behavior under 429.
- [x] T021 Implement `runStrategyContractTests(plugin, fixtures)` in `packages/plugin-sdk/testing/strategy-kit.ts`:
  - determinism over 100 runs with the same seed;
  - `chosen ⊆ options`;
  - `check` rejects inputs below `minOptions`;
  - `Math.random` / `crypto.getRandomValues` stubs throw.

### Core services

- [x] T022 [P] Write `packages/core/test/crypto.test.ts` covering:
  - password round trip;
  - wrong password fails verifier;
  - output format `enc:v1:<base64 iv>:<base64 ciphertext>`;
  - a unique 12-byte IV per call;
  - KDF parameters `pbkdf2-sha256`, 600 000 iterations, 16-byte salt.
- [x] T023 Implement the password codec in `packages/core/src/crypto/payload-codec.ts`:
  - `deriveKey(password, salt, iterations)` via WebCrypto PBKDF2;
  - `encrypt` / `decrypt` with AES-256-GCM;
  - `makeVerifier` / `checkVerifier`;
  - the key is never serialized;
  - T022 must pass.
- [x] T024 [P] Implement the export format `decisionator.project/v1` in `packages/core/src/export/project-v1.ts`, plus `scripts/gen-schemas.ts`, which emits JSON Schemas from the Zod models (via `z.toJSONSchema`) into `packages/core/schema/`.
- [x] T025 Implement the module host in `apps/web/src/host/module-host.ts` (constitution §II):
  - validate each first-party module's `decisionator-plugin.json` against `contracts/plugin-manifest.schema.json` v1.1 with Ajv, and refuse any module whose `platform.*` ranges the host doesn't satisfy, with a plain-language error;
  - register first-party modules only through the `plugin-sdk` interfaces;
  - wrap every call with a timeout (default 5 s, strategies 2 s) and error capture;
  - raise errors attributed to the module (research R26, constitution C3).
- [x] T026 [P] Create the app shell in `apps/web/src/app/App.tsx`, `apps/web/src/app/routes.tsx` and `apps/web/src/app/theme.css`:
  - routes `#/`, `#/new`, `#/p/:fileId`, `#/p/:fileId/stats`, `#/p/:fileId/vote`, `#/p/:fileId/results`, `#/p/:fileId/share`, `#/settings`;
  - Radix-based primitives;
  - CSS-variable light/dark themes;
  - a layout that works from 360 px wide.
- [x] T027 [P] Implement the IndexedDB layer in `apps/web/src/sync/db.ts` using `idb`, with stores `drafts`, `queue` and `snapshots` (data-model "Draft" and "Queued write").
- [x] T028 [P] Configure `vite-plugin-pwa` in `apps/web/vite.config.ts` to cache the app shell, with no runtime caching of Google API responses.
- [x] T029 [P] Add Google configuration in `apps/web/src/config/google.ts`: read `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_BASE_URL`, and fail with a clear message when missing (research R28).

### Google plumbing and the access spike

- [x] T030 Implement Google auth in `plugins/store-google-sheets/src/auth.ts` (FR-008, FR-081):
  - Identity Services token model requesting only `https://www.googleapis.com/auth/drive.file`;
  - token kept in memory only;
  - silent re-request on expiry, else a one-click prompt;
  - identity from Drive `about.get?fields=user(displayName,emailAddress)` (research R19).
- [x] T031 Implement the Google REST client in `plugins/store-google-sheets/src/google-api.ts` (FR-007):
  - typed `fetch` wrappers for the Drive v3 and Sheets v4 calls listed in `contracts/sheet-store.md`;
  - map `429` and `403 rateLimitExceeded` to `RateLimitedError`;
  - map `404` / `403 insufficientPermissions` to `ProjectUnavailableError(reason)`.
- [x] T032 **SPIKE (gate)** in `apps/web/src/spikes/PickerSpike.tsx`, against a real Google project: does Picker `setFileIds([fileId])` grant a second account `drive.file` access to a Sheet shared only as "anyone with the link"? (FR-016)
  - If not, test fallback 1 (open the Sheet URL in Google first, then the Picker).
  - Record the result and the chosen flow in `specs/001-decision-engine-core/research.md` § R21.
  - US2 T065 depends on this outcome. If neither flow meets FR-016 (one sign-in plus one confirmation), stop and revisit FR-016 with the product owner before Phase 4.
- [x] T033 [P] Implement the quota budget and back-off in `plugins/store-google-sheets/src/budget.ts`, with tests in `plugins/store-google-sheets/test/budget.test.ts` (FR-020):
  - ≤ 20 Sheets reads and ≤ 20 writes per minute per client;
  - truncated exponential back-off with jitter up to 1 s, capped at 64 s;
  - emits `{pausedUntil}` events.
- [x] T034 [P] Implement the write queue in `plugins/store-google-sheets/src/queue.ts`, with tests in `plugins/store-google-sheets/test/queue.test.ts` (FR-020):
  - persisted in IndexedDB;
  - flushed at most every 2 s as one `values.append` per tab;
  - survives reloads;
  - reports `{queued, sent}`.

**Checkpoint**: the foundation is ready, the spike outcome is recorded, and the US1 work can
begin.

---

## Phase 3: User Story 1 — Paste, format and grade (Priority: P1) 🎯 MVP part 1

**Goal**: a pasted idea list becomes a project in the user's Google Drive, where they can grade,
comment and view stats.

**Independent Test** (quickstart US1):
1. Paste 10 lines and round-trip through any AI.
2. Confirm, then check that a Sheet with 10 options appears in Drive.
3. Grade 3 options and comment on 1.
4. Sort by grade and group by category.

### Tests for User Story 1 (write first, must fail)

- [x] T035 [P] [US1] Write format extraction and validation tests in `packages/core/test/format/extract.test.ts`, covering (FR-004):
  - a fenced ```json block is preferred;
  - several fenced blocks lead to a "choose" result;
  - a balanced `{…}` fallback;
  - a bare array is accepted as `options`, with a warning;
  - unknown fields produce warnings;
  - over-length strings are truncated, with a warning;
  - citation markers such as `[cite: 5]` and `[cite_start]` are stripped, with a warning (rule 5; fixture `05/gemini`);
  - a string in `tags`, `pros` or `cons` is wrapped into a one-item list, with a warning (rule 6; fixture `v1.1/01/gemini`);
  - error messages such as `options[2].title: missing`.
- [x] T036 [P] [US1] Write the SC-002 replay test over the fixture set in `packages/core/test/fixtures/format-answers/` (already collected: 5 sample lists × Claude and Gemini for template versions 1.0, 1.1 and 1.2; v1.2 is current):
  - a replay test in `packages/core/test/format/fixtures.test.ts` asserting that ≥ 90% of the **current template version's** answers validate on the first paste, and reporting older versions without gating on them.
- [x] T037 [P] [US1] Wire `runProjectStoreContractTests` to the Google Sheets store and the fake backend in `plugins/store-google-sheets/test/contract.test.ts` (FR-009, FR-011).
- [x] T038 [P] [US1] Write the E2E test `apps/web/e2e/us1-create.spec.ts` (fake Google), covering quickstart US1 steps 1–8: the SC-001 timing (< 3 min with a scripted AI answer), the delete project flow (confirm by typing name, Sheet in Drive trash, removed from "My projects") (FR-025), and an axe check on the new-project, project, stats and delete-confirmation dialogs (FR-001, FR-002, FR-006, FR-007, FR-012, FR-013, FR-025).

### Implementation for User Story 1

- [x] T039 [US1] Build the format instruction in `packages/core/src/format/instruction.ts` (FR-002):
  - `buildInstruction(pastedText, localeHint?)` produces the template from `contracts/format-instruction.md` verbatim, with the paste between `<<<IDEAS` and `IDEAS>>>`;
  - `detectLanguage(pastedText)` fills the hint per contract § Language hint (`franc-min` after stripping list markers; under 20 characters or no clear winner → UI language). The format step shows the chosen language and lets the user change it;
  - `buildCorrection(errors[])` produces the correction template.
- [x] T040 [US1] Implement extraction in `packages/core/src/format/extract.ts`, following extraction rules 1–4 of `contracts/format-instruction.md` (T035 cases pass) (FR-004).
- [x] T041 [US1] Implement validation in `packages/core/src/format/validate.ts` (FR-003, FR-004):
  - validate against the `decisionator.options/v1` Zod schema, mirroring `contracts/options-format.schema.json`: options "minItems 1, maxItems 500", title "1–200";
  - return per-item, per-field errors and warnings;
  - normalize to `Option[]`.
- [x] T042 [P] [US1] Implement the plain-list parser in `plugins/source-paste/src/plain-list.ts`:
  - split lines;
  - strip `-`, `*`, `•`, `1.`, `1)` and `[ ]`;
  - trim and drop empty lines;
  - default preview cap of 500 items, the format's maximum; the user can lower it (spec FR-005, Edge Cases).
- [x] T043 [US1] Implement the paste idea source in `plugins/source-paste/src/index.ts`, following the `IdeaSource` contract (`input: "clipboard"`), and register it in the module host. It returns candidates from either validated AI JSON or the plain-list parser (FR-001, FR-005).
- [x] T044 [US1] Implement Sheet creation in `plugins/store-google-sheets/src/layout.ts` (FR-007):
  - `spreadsheets.create` with tabs `meta`, `options`, `grades`, `comments`, `rankings`, `outcomes` and their header rows exactly as in `contracts/sheet-store.md`;
  - Drive `appProperties` `decisionator=project` and `formatVersion=1`;
  - `meta` rows `formatVersion`, `title`, `description`, `protected=false`, `voting`, `createdAt` and `owner`.
- [x] T045 [US1] Implement row codecs in `plugins/store-google-sheets/src/rows.ts` (FR-009):
  - convert each tab's rows to and from entities;
  - validate with the core Zod models;
  - skip invalid rows with a warning naming tab and row;
  - flag rows whose `by` is not a known participant;
  - provide a payload hook for `enc:v1` (used in US2).
- [x] T046 [US1] Implement the Google Sheets store in `plugins/store-google-sheets/src/store.ts` (FR-007, FR-009, FR-010, FR-011):
  - `signIn`, `listProjects` (Drive `files.list` filtered by `appProperties`), `createProject`, `openProject` (one `values.batchGet`), `append` (author stamped from `about.get`, via queue and budget), `updateOptions` (owner, `values.batchUpdate`), `updateMeta` and `export`;
  - T037 must pass.
- [x] T047 [US1] Build the paste step in `apps/web/src/features/paste-format/PasteStep.tsx` (FR-001):
  - a paste box with a 200 KB limit;
  - messages for empty or non-text input and for more than 500 lines (preview cap);
  - **Format with my AI** and **Use as plain list** actions.
- [x] T048 [US1] Build the format round trip in `apps/web/src/features/paste-format/FormatStep.tsx` (FR-002, FR-004):
  - copy-instruction button;
  - answer paste box;
  - live validation result;
  - per-item error list;
  - **Copy correction for AI** button;
  - a "choose block" prompt when several JSON blocks are found.
- [x] T049 [US1] Build the preview editor in `apps/web/src/features/preview/PreviewEditor.tsx`: edit, remove and add options; edit the project title and description; flag duplicate titles; confirm (FR-006).
- [x] T050 [US1] Implement draft autosave in `apps/web/src/features/paste-format/draft.ts`: persist `pastedText`, `aiAnswer` and `preview` to IndexedDB on change, and restore on return (FR-006).
- [x] T051 [US1] Implement sign-in and creation in `apps/web/src/features/project/createProject.ts` (FR-007, FR-008):
  - request Google sign-in only on **Create project**;
  - call `createProject` and navigate to `#/p/<fileId>`;
  - if sign-in is declined, keep the draft and explain that saving and sharing need Google.
- [x] T052 [US1] Build the project page in `apps/web/src/routes/project.tsx` and `apps/web/src/features/grading/OptionDetail.tsx`: the option list (order, category, average, comment count) and option detail (description, pros/cons, effort, links) (FR-012).
- [x] T053 [US1] Build the grade control in `apps/web/src/features/grading/GradeInput.tsx`: 1–5, keyboard-operable radio group, changeable (latest wins), showing the author's name and time (FR-012, FR-014).
- [x] T054 [US1] Build comments in `apps/web/src/features/comments/CommentThread.tsx` (FR-012, FR-014):
  - markdown rendered with markdown-it and DOMPurify;
  - body "1–10 000 chars";
  - edit via a `replaces` row;
  - the owner can hide others' comments (hidden ones shown only in history).
- [x] T055 [P] [US1] Implement stats in `packages/core/src/stats/aggregate.ts`, with tests in `packages/core/test/stats.test.ts` (FR-013):
  - per option: average (1 decimal), count, distribution `[n1..n5]`, visible comments;
  - sort keys `average | count | comments | bordaPoints | title`;
  - group by `category` or tag (an option appears under each of its tags);
  - a perf test: 200 options sorted and grouped in < 1 s (SC-008).
- [x] T056 [US1] Build the stats view in `apps/web/src/features/stats/StatsView.tsx`: sort and group controls, distribution bars, and an accessible table fallback (FR-013).
- [x] T057 [US1] Build My projects in `apps/web/src/routes/home.tsx`: `listProjects()` with the last-opened time, an offline view from the `snapshots` store, and **New project** as the empty-state action (FR-010).
- [x] T058 [P] [US1] Build export in `apps/web/src/features/project/ExportButton.tsx`: download `decisionator.project/v1` JSON with no tokens or passwords (FR-080, FR-081).
- [x] T059 [US1] Build delete and forget in `apps/web/src/features/project/DeleteProject.tsx` and `deleteProject`/`forgetProject` in `plugins/store-google-sheets/src/store.ts` (FR-025, constitution V):
  - owner only for delete; confirmation by typing the project name;
  - Drive `files.update {trashed: true}`;
  - clear the project's IndexedDB drafts, snapshot and queue; remove it from My projects;
  - non-owners get "Remove from my list" (`forgetProject`, local only).
- [x] T060 [US1] Build unavailable states in `apps/web/src/features/project/ProjectUnavailable.tsx`: deleted, trashed or access-lost Sheets show the detectable reason, and never create a silent copy (spec edge cases).

**Checkpoint**: US1 works alone (personal idea board), and quickstart US1 passes.

---

## Phase 4: User Story 2 — Share by link and collaborate (Priority: P2) 🎯 MVP part 2

**Goal**: share like a Google Doc (view or contribute, optional password). Collaborators grade
and comment, and see each other's input live.

**Independent Test** (quickstart US2): a second account opens the link, grades 2 options and
comments once. The owner sees it within 30 s, and view-only and password behaviors hold.

### Tests for User Story 2 (write first, must fail)

- [x] T061 [P] [US2] Write sharing and password store tests in `plugins/store-google-sheets/test/share.test.ts`, covering (FR-015, FR-017, FR-018):
  - `anyone` reader and writer with `allowFileDiscovery: false`;
  - link off;
  - invite and remove by email;
  - individual removal on a link-shared project throws `NOT_SUPPORTED` with a readable message;
  - role mapping owner/writer/reader → owner/contribute/view;
  - in password mode no plaintext title, option or comment reaches the fake Sheets (SC-007).
- [x] T062 [P] [US2] Write the E2E test `apps/web/e2e/us2-share.spec.ts` with two browser contexts, covering quickstart US2 steps 1–6 (FR-015, FR-016, FR-019, FR-020):
  - a collaborator's first grade within 1 min (SC-003);
  - visibility within 30 s (SC-004);
  - view-only gating;
  - password prompt and lockout;
  - a forced 429 that shows the banner and loses no input.

### Implementation for User Story 2

- [x] T063 [US2] Implement share operations in `plugins/store-google-sheets/src/share.ts`: `share()` and `getShareState()` using the Drive permission calls in `contracts/sheet-store.md` § Sharing operations (FR-015, FR-018).
- [x] T064 [US2] Build the share dialog in `apps/web/src/features/sharing/ShareDialog.tsx` (FR-015):
  - copy link (`<VITE_BASE_URL>#/p/<fileId>`);
  - access level (view or contribute);
  - link on/off;
  - invite by email;
  - an explanation that only email-invited people can be removed individually (FR-018).
- [x] T065 [US2] Build the collaborator join flow in `apps/web/src/features/sharing/JoinFlow.tsx` (it also shows which Google account is signed in and offers "Switch account" when access is denied, per spec Edge Cases): Google sign-in, then Picker `setFileIds([fileId])`, or the fallback recorded by T032. At most one sign-in plus one confirmation (FR-016).
- [x] T066 [US2] Implement role resolution in `plugins/store-google-sheets/src/roles.ts` and `apps/web/src/features/project/useRole.ts` (FR-015):
  - `plugins/store-google-sheets/src/roles.ts` reads Drive permissions and capabilities and returns the role;
  - `apps/web/src/features/project/useRole.ts` disables grade, comment and vote for view access, with the reason text (US2 #5).
- [x] T067 [US2] Implement password setup in `apps/web/src/features/sharing/PasswordSetup.tsx` and password mode in `plugins/store-google-sheets/src/store.ts` (FR-017):
  - `apps/web/src/features/sharing/PasswordSetup.tsx` requires at least 12 characters and warns that a lost password is unrecoverable;
  - it states which metadata stays readable in the Sheet (participants' emails, option IDs, timestamps, counts);
  - the store writes `kdf`, `kdfIterations`, `salt` and `verifier` to `meta`;
  - it encrypts the `title` and `description` meta values, `options` payloads and all entry payloads as `enc:v1:…`;
  - it renames the Sheet to "Deci project (protected)".
- [x] T068 [US2] Build the password prompt in `apps/web/src/features/sharing/PasswordPrompt.tsx`: show no content until the verifier passes; after 5 wrong tries, wait 30 s; keep the derived key in memory for the session only (FR-017).
- [x] T069 [US2] Implement watching in `plugins/store-google-sheets/src/watch.ts` (FR-019, FR-020):
  - while `document.visibilityState === "visible"`, poll Drive `files.get?fields=version` every 10 s;
  - on a version change, do one `values.batchGet`, at most every 15 s;
  - stop when hidden;
  - stay within the budget (research R23).
- [x] T070 [US2] Build the sync banner in `apps/web/src/sync/SyncBanner.tsx`: "syncing paused, retrying in N s" with the queued count, driven by budget, back-off and queue events (FR-020).
- [x] T071 [US2] Implement live snapshot merging in `apps/web/src/sync/useProjectSnapshot.ts`: apply incoming snapshots without discarding queued local entries; show others' new grades and comments without a reload (FR-019).
- [x] T072 [P] [US2] Build the dev toolbar in `apps/web/src/dev/DevToolbar.tsx`, in dev builds only: "force 429" and "go offline" toggles for the quickstart and E2E.

**Checkpoint**: US1 and US2 work together. Quickstart US2 passes.

---

## Phase 5: User Story 3 — Ranked vote and results (Priority: P3) 🎯 MVP part 3

**Goal**: contributors rank their top N, the owner closes voting, and a deterministic Borda tally
records a verifiable outcome.

**Independent Test** (quickstart US3): 3 accounts rank their top 3 of 6 options and the owner
closes voting. The result shows the winner, the order and the points, and Verify says
"Reproduced ✓".

### Tests for User Story 3 (write first, must fail)

- [x] T073 [P] [US3] Write Borda strategy tests in `plugins/strategy-borda/test/contract.test.ts` (FR-023, FR-024):
  - `runStrategyContractTests`;
  - rank r on a top-N ballot earns N − r + 1 points, and unranked options earn 0;
  - partial ballots;
  - the tie-break chain is higher average grade → more first places → seeded random draw, with the seed recorded only when the random step is needed;
  - determinism over 100 runs (SC-006).
- [x] T074 [P] [US3] Write the E2E test `apps/web/e2e/us3-vote.spec.ts`, covering quickstart US3 steps 1–5 (re-vote replaces, close, tie broken by average grade, Verify, reopen → round 2) and an axe check on the vote and results screens (FR-021, FR-022, FR-023, FR-024).

### Implementation for User Story 3

- [x] T075 [US3] Implement the Borda strategy in `plugins/strategy-borda/src/index.ts` and `plugins/strategy-borda/decisionator-plugin.json` (FR-023):
  - `provides.strategy {usesRandomness: true, minOptions: 2, ballots: "ranking"}`;
  - a settings schema with `topN` 1–10, default 3;
  - `check` and `decide` per `contracts/strategy.md` and research R25.
- [x] T076 [US3] Implement voting rounds in `packages/core/src/voting/rounds.ts` (FR-021, FR-022):
  - the state machine `open(n) → closed(n) → open(n+1)`;
  - effective ballot = latest per (by, round) with `at` ≤ the close time;
  - ballots must be unique, ≤ topN and only from active options.
- [x] T077 [US3] Implement the tally host in `packages/core/src/strategy-host/tally.ts` (FR-024):
  - build `StrategyInput` (options, effective ballots, aggregated grades) from a snapshot;
  - generate a 128-bit seed from a CSPRNG at close;
  - call the strategy through the module host;
  - build an immutable `OutcomeRecord` (data-model § Outcome);
  - append it via the store.
- [x] T078 [US3] Build the ballot UI in `apps/web/src/features/voting/RankBallot.tsx`: drag to rank with `@dnd-kit` and an equivalent keyboard control (move up/down); top N from `meta.voting.topN`; submit and resubmit replace the ballot (FR-021).
- [x] T079 [US3] Build owner voting controls in `apps/web/src/features/voting/VotingControls.tsx`: open, close and reopen voting; set `topN` 1–10 and `liveResults` on/off; owner only (writes `meta.voting`) (FR-022).
- [x] T080 [US3] Build the results view in `apps/web/src/features/voting/ResultsView.tsx` (FR-022, FR-024):
  - winner, full order with points and first places, tie-break used, ballots counted;
  - round history;
  - "voting in progress (N ballots)" when live results are off.
- [x] T081 [US3] Build Verify in `apps/web/src/features/voting/VerifyButton.tsx`: re-run the tally on the outcome's recorded `inputs` and `seed` with the same strategy version, then show "Reproduced ✓", "Mismatch" or "Strategy unavailable" (FR-024).
- [x] T082 [US3] Add the `bordaPoints` sort key to `apps/web/src/features/stats/StatsView.tsx`, shown only when results are visible (FR-013).

**Checkpoint**: US1–US3 are complete. This is the owner's full first user story.

---

## Phase 6: MVP Release (v0.1)

**Purpose**: harden, document and ship US1–US3.

- [x] T083 [P] Write `scripts/soak/twenty-collaborators.ts`: 20 simulated clients on one project for 10 min against the fake backend's quota model. Assert ≤ 20 Sheets reads per client per minute and zero lost entries (SC-005).
- [x] T084 [P] Write `docs/self-hosting.md`: creating your own Google Cloud project, the OAuth Web client (authorized JavaScript origin), the Picker-restricted API key, publishing the consent screen with only `drive.file`, and `VITE_*` variables (research R28).
- [x] T085 [P] Write `docs/plugin-authors.md`: the project-store, idea-source and strategy contracts with links to `contracts/`, and how to run the plugin-sdk test kits.
- [x] T086 [P] Create example plugins for every MVP extension point (constitution: each extension point ships with an example and author docs), each with a README and passing its contract kit (FR-055):
  - `examples/plugin-store-memory/`: a `ProjectStore` over an in-memory model (`runProjectStoreContractTests`);
  - `examples/plugin-strategy-example/`: a simple strategy (`runStrategyContractTests`);
  - `examples/plugin-source-example/`: an idea source (`runIdeaSourceContractTests`).
- [x] T087 Run an axe audit across all MVP screens and fix every WCAG 2.1 AA violation (FR-082); record the result in `apps/web/e2e/README.md`.
- [x] T088 Run the live Google checklist from `specs/001-decision-engine-core/quickstart.md` against the hosted build. Measure load performance against the ≤ 2.5 s interactive aim on mobile 4G (Lighthouse audit). Record the results in `docs/releases/v0.1.md`, together with a "Known limitations" section disclosing the staged-compliance deferrals from plan.md (no agent API until US5; offline limited to drafts and the write queue until US7).
- [x] T089 Update `README.md` with the hosted URL `https://kpsolo.github.io/decisionator/`, a 3-step "how it works" and screenshots. Add a changeset and tag `v0.1.0`.

**Checkpoint**: the MVP is released.

---

## Phase 7: User Story 4 — Strategy modules (Priority: P4)

**Goal**: owner pick, uniform random and random weighted by average grade, all verifiable.
**Independent Test**: run a weighted draw; Verify says "Reproduced". Install a sample strategy.

- [x] T090 [P] [US4] Write contract tests in `plugins/strategy-owner-pick/test/contract.test.ts`, `plugins/strategy-random/test/contract.test.ts` and `plugins/strategy-weighted/test/contract.test.ts`. For weighted: ungraded options excluded unless included, and frequencies within tolerance over 10 000 seeds (FR-030, FR-031).
- [x] T091 [P] [US4] Implement `plugins/strategy-owner-pick/src/index.ts` (`interactive: true`, `runInputSchema` = an option ID, `usesRandomness: false`) (FR-030).
- [x] T092 [P] [US4] Implement `plugins/strategy-random/src/index.ts` (uniform, via `rng.int(n)`) (FR-030).
- [x] T093 [P] [US4] Implement `plugins/strategy-weighted/src/index.ts` (weight = average grade; owner setting `includeUngraded`, default false) (FR-030).
- [x] T094 [US4] Build the strategy chooser in `apps/web/src/features/decide/StrategyChooser.tsx`: list registered strategies, explain unmet preconditions in plain language (FR-032), and record outcomes through `tally.ts` (FR-030).
- [x] T095 [US4] Generalize `apps/web/src/features/voting/VerifyButton.tsx` to verify any strategy outcome (FR-031).

---

## Phase 8: User Story 5 — Connected AI and agent API (Priority: P5)

**Goal**: connect an agent for automatic formatting and research, with scoped, reviewable
contributions.
**Independent Test**: formatting without copy-paste; a sourced, attributed note "pending review"
on an option.

- [x] T096 [US5] **Planning checkpoint**: refine plan.md for US5. Decide how a hosted web app reaches a local or remote agent: the local node from research R2 vs other options. Add a `contributions` tab to the Sheet format (v2) and a migration from v1. Update `contracts/agentic-api.md` and `contracts/sheet-store.md`.
- [x] T097 [P] [US5] Write agent API contract tests in `packages/node/test/contract/agentic-api.test.ts` for MCP and REST: each operation, permission denials, expired, revoked and cancelled grants, out-of-scope targets, the limits table, and MCP/OpenAPI parity (FR-040, FR-042, FR-044).
- [x] T098 [US5] Scaffold `packages/node/`: a Hono server bound to `127.0.0.1:4178` with Host/Origin checks (research R14) (FR-040).
- [x] T099 [US5] Implement grants in `packages/node/src/agent-api/grants.ts`: 256-bit bearer tokens stored as SHA-256 hashes, scope, default expiry 24 h (max 30 days), revocation, and counters (≤ 50 contributions per request, ≤ 60 calls per minute) (FR-042).
- [x] T100 [US5] Implement the MCP server in `packages/node/src/agent-api/mcp.ts` (MCP TS SDK v2), with the tools from `contracts/agentic-api.md`: `agent_hello`, `get_request`, `get_context`, `list_contributions`, `add_contribution`, `update_contribution`, `propose_option`, `complete_request` (FR-040).
- [x] T101 [US5] Implement REST and OpenAPI in `packages/node/src/agent-api/rest.ts`: `/api/v1` plus `/api/v1/openapi.json`, generated from the same Zod schemas (FR-040).
- [x] T102 [US5] Build agent connection and auto-format in `apps/web/src/features/agents/ConnectAgent.tsx`: when connected, send `buildInstruction()` to the agent and skip the copy-paste step (FR-041).
- [x] T103 [US5] Build the agent brief and review in `apps/web/src/features/agents/AgentBrief.tsx` and `apps/web/src/features/agents/ContributionReview.tsx` (FR-043, FR-044):
  - a copyable brief;
  - pending/accepted/edited/dismissed review;
  - attribution "agent X for person Y";
  - a visible audit of refused actions (FR-043, FR-044).

---

## Phase 9: User Story 6 — Plugins and more idea sources (Priority: P6)

**Goal**: sandboxed third-party plugins, generated settings and the Google Docs source.
**Independent Test**: install a sample plugin, approve permissions, change a setting, disable it.
The app keeps working.

- [x] T104 [US6] **Planning checkpoint**: adapt research R4 to static hosting. GitHub Pages cannot set CSP headers, so use `<iframe sandbox="allow-scripts" srcdoc>` with a `<meta http-equiv="Content-Security-Policy">` built from granted `net:` permissions. Record this in research.md.
- [x] T105 [P] [US6] Write plugin runtime tests in `apps/web/test/plugin-host/runtime.test.ts`: RPC envelope, timeouts and teardown, `PERMISSION_DENIED`, incompatible `platform.*` refusal, and determinism stubs for strategies (FR-052).
- [x] T106 [US6] Build the sandbox host in `apps/web/src/host/sandbox/`: frame manager, `postMessage` RPC per `contracts/plugin-runtime.md`, the capability bridge (clipboard text, OAuth token via Identity Services, project snapshot) and UI slots (FR-050, FR-052).
- [ ] T107 [US6] Build install and management in `apps/web/src/features/plugins/PluginsPage.tsx` (FR-050, FR-061):
  - install from file or URL (with an "unreviewed source" warning);
  - manifest validation (Ajv, `contracts/plugin-manifest.schema.json`);
  - permission review;
  - enable/disable and uninstall;
  - `lastError`.
- [ ] T108 [US6] Build generated settings in `apps/web/src/features/plugins/PluginSettings.tsx` with `@rjsf/core` and a Radix theme (FR-053).
- [ ] T109 [US6] Switch `apps/web/src/host/module-host.ts` to load the first-party modules (`source-paste`, `strategy-*`) through the sandbox host with unchanged contracts; the store stays in-process (it holds the Google token) (FR-051).
- [ ] T110 [P] [US6] Build `plugins/source-google-docs/`: web Picker, `documents.get`, list items or heading sections as ideas, `itemKey = sha256(documentId + normalizedText)`, plus `runIdeaSourceContractTests` (FR-054).
- [ ] T111 [P] [US6] Create `examples/fixtures/{plugin-incompatible,plugin-hang}/` for the plugin-area E2E tests, and package the Phase 6 example plugins for install from file or URL.

---

## Phase 10: User Story 7 — Local-first mode (Priority: P7)

**Goal**: Deci without Google: data on the device, sharing through an E2E-encrypted,
self-hostable relay.
**Independent Test**: share between two devices via a self-hosted relay; relay storage has no
readable option titles.

- [ ] T112 [US7] **Planning checkpoint**: refine plan.md for local mode. Decide whether the local store runs in the browser (IndexedDB + Automerge) or in `packages/node`, and how it maps the grade/comment/ranking entries onto Automerge documents. Update `contracts/relay-protocol.md` if needed.
- [ ] T113 [P] [US7] Write relay tests in `packages/relay/test/relay.test.ts`: signed requests, ACL enforcement, the append-only change log, the two-step invite, revocation with key rotation, and the limits table (FR-071).
- [ ] T114 [US7] Build `packages/relay/`: Hono with SQLite storage, implementing `contracts/relay-protocol.md`, plus `Dockerfile` and `compose.yaml` (FR-071).
- [ ] T115 [US7] Build `plugins/store-local/`: a `ProjectStore` backed by Automerge 3, synced through the relay with XChaCha20-Poly1305 and Ed25519 (`@noble/*`). It must pass `runProjectStoreContractTests` (FR-070, FR-071).
- [ ] T116 [US7] Build import/export between modes in `apps/web/src/features/project/MoveProject.tsx`, using `decisionator.project/v1` (FR-072).

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T117 [P] Run `/speckit-analyze` and resolve any spec, plan or tasks inconsistencies before each release.
- [ ] T118 Run a security review of `packages/core/src/crypto/`, `plugins/store-google-sheets/src/auth.ts` and (US5+) `packages/node/src/agent-api/` before marking any release stable (FR-081).
- [ ] T119 Run the full `specs/001-decision-engine-core/quickstart.md` validation for every shipped story.

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (P1) → Foundational (P2) → US1 (P3) → US2 (P4) → US3 (P5) → MVP release (P6).
- After the MVP: US4, US5, US6 and US7 (P7–P10) depend only on the MVP and can run in any
  order.
- US6 T109 touches modules from US4, if US4 is done first.

### Within phases

- T011 → T013; T014–T016 → T017; T018 → T019 → T020 and T021; T022 → T023.
- T030 and T031 → T032 (spike). T032 → T065.
- T035–T038 (tests) before T039–T060. T044 and T045 → T046. T039–T041 → T043 → T047–T049.
- T061 and T062 before T063–T072. T063 → T064. T069 → T070 and T071.
- T073 and T074 before T075–T082. T076 → T077 → T080 and T081.

### Story independence

- US1 alone is a personal idea board.
- US2 adds people to a US1 project.
- US3 adds a vote on top of US2 (testable with 1 owner + test accounts).

## Parallel Examples

```text
# Foundational, after T005/T006:
T011 rng.test.ts | T012 vectors.json | T014 project/option schemas | T015 entries schemas | T016 outcome schema | T022 crypto.test.ts

# US1 tests together:
T035 extract.test.ts | T036 format-answers fixtures | T037 store contract | T038 us1 e2e

# US1 implementation in parallel lanes:
Lane A (core):  T039 → T040 → T041
Lane B (store): T044 → T045 → T046
Lane C (UI):    T047 → T048 → T049 (after lane A); T052–T057 (after lane B)
Independent:    T042, T055, T058

# US4 strategies together:
T091 | T092 | T093
```

## Success Criteria → Owning Tasks

| SC | Owning task(s) |
|----|----------------|
| SC-001 paste → saved project < 3 min | T038 |
| SC-002 ≥ 90% AI answers valid on first paste | T036 |
| SC-003 link → first grade < 1 min | T062 |
| SC-004 visible ≤ 30 s (95%) | T062, T069 |
| SC-005 20 collaborators within free quotas, no loss | T083, T088 |
| SC-006 tallies reproduce 100% | T073, T081 |
| SC-007 password content unreadable | T061, T062 |
| SC-008 stats for 200 options < 1 s | T055 |
| SC-009 zero server cost | T009, T088 |

## Implementation Strategy

1. **MVP first**: Phases 1 → 6. Stop at each checkpoint and run that story's quickstart.
2. **Spike early**: T032 runs before any US2 UI. If both Picker flows fail, US2 uses invite by
   email as the primary join flow, and FR-016 is revisited with the owner.
3. **Then increments**: pick US4–US7 by interest; each begins with its planning checkpoint
   (T096, T104, T112), except US4, which is fully specified.
4. Commit after each task or logical group, using Conventional Commits.

## Notes

- [P] means different files and no dependency on unfinished tasks.
- Contract and strategy tests must be seen failing before their implementation (Principle VII).
- Never call real Google APIs in CI. Use the fake backend (T019). Live checks are T032 and T088.
