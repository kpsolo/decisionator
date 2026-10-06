# Tasks: Local & Universal Storage with In-Page Sharing

**Branch**: `002-local-storage-sharing` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo workspace configuration and dependency installations

- [x] T001 Initialize plugin package directories for `plugins/store-file`, `plugins/store-firestore`, and `plugins/share-inpage`
- [x] T002 Add `firebase` dependency to `plugins/store-firestore/package.json` and install workspace dependencies via `pnpm install`
- [x] T003 [P] Configure TypeScript compiler options in `plugins/store-file/tsconfig.json`, `plugins/store-firestore/tsconfig.json`, and `plugins/share-inpage/tsconfig.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core universal storage contracts and router generalizations that MUST be complete before user stories

- [x] T004 Define `StorageManager` interface and store registry contracts in `packages/plugin-sdk/src/storage-manager.ts`
- [x] T005 [P] Export storage manager types from `packages/plugin-sdk/src/index.ts`
- [x] T006 Generalize React Router routes in `apps/web/src/app/routes.tsx` to support `/p/:storeId/:id` alongside backward-compatible `/p/:fileId`
- [x] T007 Implement the core `StorageManager` registry and local active store persistence in `apps/web/src/storage/storage-manager.ts`

**Checkpoint**: Universal storage abstractions and routing foundations ready. User stories can now proceed.

---

## Phase 3: User Story 1 - Local-First Decision Making with File Storage (Priority: P1) 🎯 MVP

**Goal**: Enable users to create, view, edit, and persist decision projects completely offline to local files (`.decisionator.json`) via File System Access API with download/import fallback.

**Independent Test**: Create a project in an offline browser, save it to disk as `.decisionator.json`, restart the browser, reopen the file, and verify all options, votes, and outcomes are intact.

### Tests for User Story 1

- [x] T008 [P] [US1] Create contract test suite for `FileProjectStore` in `plugins/store-file/test/contract.test.ts` verifying `runProjectStoreContractTests`

### Implementation for User Story 1

- [x] T009 [P] [US1] Create plugin manifest in `plugins/store-file/decisionator-plugin.json` declaring `org.decisionator.store.file`
- [x] T010 [US1] Implement `FileProjectStore` adhering to `ProjectStore` using File System Access API (`FileSystemFileHandle`) in `plugins/store-file/src/file-store.ts`
- [x] T011 [P] [US1] Implement fallback file download and `<input type="file">` reader for non-supporting browsers in `plugins/store-file/src/download-fallback.ts`
- [x] T012 [US1] Export `FileProjectStore` from `plugins/store-file/src/index.ts` and register as default fallback in `apps/web/src/storage/storage-manager.ts`
- [x] T013 [US1] Add "Open from File" button and drag-and-drop zone to `apps/web/src/app/HomePage.tsx`
- [x] T014 [US1] Update `apps/web/src/features/paste-format/NewProjectWizard.tsx` to support direct saving to local file when no remote store is connected

**Checkpoint**: At this point, User Story 1 is fully functional and provides a complete offline MVP.

---

## Phase 4: User Story 2 - Universal Storage Selection & Multi-Backend Support (Priority: P2)

**Goal**: Provide a unified storage selector in Settings, persist the active storage preference, and allow seamless switching and lossless migration across all backends.

**Independent Test**: Change active storage to Firestore or Google Drive in settings, verify new projects default to that backend, and use the migration dialog to move a local file project to cloud storage losslessly.

### Tests for User Story 2

- [x] T015 [P] [US2] Add unit tests for `StorageManager` registry, store resolution, and preference persistence in `apps/web/src/storage/storage-manager.test.ts`

### Implementation for User Story 2

- [x] T016 [US2] Implement `StorageContext` React provider and `useStorage` hook in `apps/web/src/storage/StorageContext.tsx`
- [x] T017 [US2] Build `StorageSettings` UI panel in `apps/web/src/features/settings/StorageSettings.tsx` displaying status badges and provider selection
- [x] T018 [US2] Mount `StorageSettings` in `apps/web/src/app/pages.tsx` (Settings page)
- [x] T019 [US2] Refactor `apps/web/src/app/ProjectViewPage.tsx` to resolve project store dynamically via `useStorage().resolveStore(ref)`
- [x] T020 [US2] Update `apps/web/src/features/project/MoveProject.tsx` to allow selecting any registered source and target store for lossless project migration

**Checkpoint**: Universal storage provider switching and cross-backend migrations operational.

---

## Phase 5: User Story 3 - Firestore Cloud Storage Integration (Priority: P3)

**Goal**: Provide a real-time collaborative Firestore store plugin alongside Google Sheets, supporting live `onSnapshot` subscriptions, append-only logs, and WebCrypto encryption.

**Independent Test**: Connect two browser windows to the same Firestore project ID, submit a grade or vote in window A, and verify window B updates in real time (<1s) without refreshing.

### Tests for User Story 3

- [x] T021 [P] [US3] Create contract test suite for `FirestoreProjectStore` in `plugins/store-firestore/test/contract.test.ts` against in-memory Firestore / emulator

### Implementation for User Story 3

- [x] T022 [P] [US3] Create plugin manifest in `plugins/store-firestore/decisionator-plugin.json` declaring `org.decisionator.store.firestore`
- [x] T023 [P] [US3] Implement Firestore collection references and converter schemas in `plugins/store-firestore/src/collections.ts`
- [x] T024 [P] [US3] Implement client-side WebCrypto AES-GCM encryption helper for password-protected projects in `plugins/store-firestore/src/crypto.ts`
- [x] T025 [US3] Implement `FirestoreProjectStore` complying with `ProjectStore` using modular Firebase v10 SDK in `plugins/store-firestore/src/firestore-store.ts`
- [x] T026 [US3] Export `FirestoreProjectStore` from `plugins/store-firestore/src/index.ts` and wire into `apps/web/src/storage/storage-manager.ts`
- [x] T027 [US3] Add Firebase credentials configuration fields to `apps/web/src/features/settings/StorageSettings.tsx`

**Checkpoint**: Firestore cloud store functional with real-time sync, append-only audit logs, and encryption.

---

## Phase 6: User Story 4 - Direct In-Page Local Sharing & Peer Collaboration (Priority: P4)

**Goal**: Enable a host browser tab to act as an authoritative in-page server, coordinating real-time voting directly over WebRTC DataChannels and BroadcastChannel without third-party servers.

**Independent Test**: Start an in-page live session from a local project in Host Window A, open the generated join link in Guest Window B, submit a vote in B, and verify Host A receives and tallies the vote into the local file.

### Tests for User Story 4

- [x] T028 [P] [US4] Add protocol serialization and handshake tests in `plugins/share-inpage/test/protocol.test.ts`

### Implementation for User Story 4

- [x] T029 [P] [US4] Define in-page peer message schemas and validation in `plugins/share-inpage/src/protocol.ts`
- [x] T030 [US4] Implement `InPageHostServer` managing connected peer channels, verifying incoming ballots, and broadcasting snapshot updates in `plugins/share-inpage/src/host-server.ts`
- [x] T031 [US4] Implement `InPagePeerClient` handling guest connection, local state cache, and ballot submission in `plugins/share-inpage/src/peer-client.ts`
- [x] T032 [US4] Export in-page sharing classes from `plugins/share-inpage/src/index.ts`
- [x] T033 [US4] Build `InPageShareModal` with QR code, shareable link, and active peer count in `apps/web/src/features/sharing/InPageShareModal.tsx`
- [x] T034 [US4] Build `PeerJoinFlow` guest voting screen for incoming peer links (`#join=p2p:...`) in `apps/web/src/features/sharing/PeerJoinFlow.tsx`
- [x] T035 [US4] Integrate In-Page Share button into `apps/web/src/app/ProjectViewPage.tsx` and route handler in `apps/web/src/app/routes.tsx`

**Checkpoint**: In-page local peer collaboration operational with live voting and zero-backend coordination.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validation, consistency checks, linting, and documentation

- [x] T036 [P] Execute TypeScript typechecking across all workspace packages via `pnpm typecheck`
- [x] T037 [P] Execute Biome lint checks and formatting across workspace via `pnpm lint`
- [x] T038 Execute end-to-end quickstart validation scenarios defined in `specs/002-local-storage-sharing/quickstart.md`
- [x] T039 [P] Update `README.md` and `CLAUDE.md` documenting universal storage backends, local file usage, and in-page sharing

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: No dependencies — executes first.
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories.
- **User Story 1 (Phase 3 - P1)**: Depends on Phase 2 — MVP delivery.
- **User Story 2 (Phase 4 - P2)**: Depends on Phase 2 & US1 file store availability.
- **User Story 3 (Phase 5 - P3)**: Depends on Phase 2 & US2 storage context.
- **User Story 4 (Phase 6 - P4)**: Depends on Phase 2 & US1 project snapshot loading.
- **Polish (Phase 7)**: Depends on completion of all implemented user stories.

### Parallel Opportunities
- T003, T005, T006 can run in parallel during Setup & Foundational.
- In US1: T008 (contract test), T009 (manifest), and T011 (download fallback) can run in parallel.
- In US3: T021 (contract test), T022 (manifest), T023 (collections), and T024 (crypto) can run in parallel.
- In US4: T028 (protocol test) and T029 (protocol types) can run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1: Local File Storage).
3. Validate Scenario 1 from `quickstart.md`: Create and edit a decision purely offline with local file persistence.
4. Deliver MVP.

### Incremental Delivery
1. Foundation + US1 → Offline Local File MVP.
2. Add US2 → Storage Settings & Cross-Store Migration.
3. Add US3 → Firestore Real-Time Cloud Store alongside Google Drive.
4. Add US4 → In-Page Live Peer Sharing ("In-page server").
5. Run Phase 7 Polish & Quickstart validation.
