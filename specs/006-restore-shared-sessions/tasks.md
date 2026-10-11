# Tasks: Restore Shared Sessions Across Devices and Disconnects

**Input**: Design documents from `specs/006-restore-shared-sessions/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/session-restore.md](./contracts/session-restore.md), [quickstart.md](./quickstart.md)  
**Tests**: Included. Constitution VII requires contract and unit tests before host, storage, and UI changes.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database schema expansion, protocol schemas, and routing entry points.

- [ ] T001 Register `live_sessions` object store in `DecisionatorDB` schema and upgrade handler in `apps/web/src/sync/db.ts`
- [ ] T002 [P] Define TypeScript types, schemas, and `session_revoked` error code for session restoration and tombstones in `plugins/share-inpage/src/protocol.ts`
- [ ] T003 [P] Add route `{ path: "/sessions", element: <SessionsDashboard /> }` to `apps/web/src/app/routes.tsx` and export navigation links in `apps/web/src/app/pages.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core session indexing, revocation tracking, and IndexedDB cache helpers that block user stories.

- [ ] T004 [P] Implement reverse session lookup helpers `saveHostSessionIndex`, `resolveHostProject`, and revocation registry in `apps/web/src/features/live/live-config.ts`
- [ ] T005 [P] Implement IndexedDB cache access helpers (`cacheLiveSession`, `getCachedLiveSession`, `listCachedLiveSessions`, `deleteCachedLiveSession`) in `apps/web/src/sync/db.ts`
- [ ] T006 Write unit and contract tests for reverse index and cache helpers in `apps/web/src/features/live/live-config.test.ts` and `apps/web/src/sync/db.test.ts`

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Project owner resumes hosting from a shared link or after reload (Priority: P1) 🎯 MVP

**Goal**: Recognize the host on `/join/:sessionId/:secret` via reverse index, and persist active hosting across tab reloads (F5) so guests reconnect without disruption.

**Independent Test**: An owner starts a live session, closes tab, and opens the join link in chat; recognized as owner, clicks "Resume Live Session", and re-hosts on the same credentials. When reloading the page, hosting auto-resumes within 5 seconds.

### Tests for User Story 1
- [ ] T007 [P] [US1] Write unit test for host reverse resolution and reload auto-resume in `apps/web/src/features/live/host-resume.test.ts`

### Implementation for User Story 1
- [ ] T008 [US1] Update `apps/web/src/features/live/LiveShareContext.tsx` to persist active hosting descriptor to `sessionStorage["deci.live.activeHosting"]` on `start()`, clear on `stop()`, and auto-resume hosting on mount if active hosting descriptor is present
- [ ] T009 [US1] Update `apps/web/src/features/live/GuestSession.tsx` (`JoinLivePage`) to check `resolveHostProject(sessionId)`: if matched and not revoked, render Host Resume card with "Resume Live Session" and "Open Project" actions, redirecting to `/p/:store/:id`
- [ ] T010 [US1] Add E2E Playwright test in `apps/web/e2e/live-session-resume.spec.ts` testing host page reload resilience and guest auto-reconnection

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Returning guests view the session when the host is offline (Priority: P1)

**Goal**: Cache deliberations in IndexedDB (`live_sessions`) so returning guests immediately view decisions, options, comments, and outcomes even when the host is offline.

**Independent Test**: Gina joins a session, votes, and closes her tab. The host closes their tab. Gina re-opens the link; the workspace loads from IndexedDB in <1s displaying previous grades, ballots, and results with an offline banner.

### Tests for User Story 2
- [ ] T011 [P] [US2] Write unit test for guest offline cache lifecycle in `apps/web/src/features/live/guest-cache.test.ts`

### Implementation for User Story 2
- [ ] T012 [US2] Update `apps/web/src/features/live/GuestSession.tsx` to read `getCachedLiveSession(sessionId)` on mount: if found, render `GuestWorkspace` immediately in cached offline mode with banner "Host is offline • Showing session from [Time]" while `guest.start()` dials in background
- [ ] T013 [US2] Update `apps/web/src/features/live/GuestSession.tsx` to persist received `welcome` and `snapshot` payloads to IndexedDB via `cacheLiveSession(...)`, and disable submissions while offline with informative explanation
- [ ] T014 [US2] Add E2E Playwright test step in `apps/web/e2e/live-session-resume.spec.ts` verifying guest offline viewing and smooth upgrade to live when host reconnects

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 5 - Project owners and participants manage and revoke shared sessions (Priority: P1)

**Goal**: Central Sessions Dashboard (`/sessions`) and live session controls for owners to monitor shared decisions, inspect participant rosters with real-time submission counts, drop errant votes from specific participants, toggle live sessions between contribution and read-only modes, revoke access links (rotating credentials and ejecting peers), and purge relay snapshots via tombstones. Guests can view their history and purge local cached data.

**Independent Test**: An owner hosts a live session with Gina and Tom. Tom submits an invalid ballot. The owner opens the participant list in the live panel, clicks "Drop votes" for Tom, and turns on "Read-only mode". Tom's ballot is cleared from the tally, and both Gina's and Tom's screens immediately show "The host made this session view-only" with voting inputs disabled.

### Tests for User Story 5
- [ ] T015 [P] [US5] Write unit tests for link revocation and peer ejection in `plugins/share-inpage/test/revocation.test.ts`
- [ ] T016 [P] [US5] Write contract and unit tests for dynamic host role toggle (`setRole`), snapshot role broadcast, and submission rejection when view-only in `plugins/share-inpage/test/host-role.test.ts`
- [ ] T017 [P] [US5] Write unit tests for participant vote dropping (`scope: "participant"` reset entry) and participant roster computation in `apps/web/src/features/live/participant-roster.test.ts`

### Implementation for User Story 5
- [ ] T018 [US5] Implement `revoke(reason?: string)` in `plugins/share-inpage/src/host.ts`: ejects all open links with `{ t: "error", code: "session_revoked", message: "This session link has been revoked by the owner." }` and closes transport
- [ ] T019 [US5] Implement `setRole(role: LiveRole)` in `plugins/share-inpage/src/host.ts`: broadcasts updated `role` in snapshot messages and rejects guest submissions with `{ t: "error", code: "read_only", message: "The host made this session view-only." }` when `role === "view"`
- [ ] T020 [US5] Update `plugins/share-inpage/src/guest.ts` to handle `error` code `session_revoked` (transitions to `revoked` status) and update `this.state.role` upon receiving `snapshot` messages
- [ ] T021 [US5] Implement interactive participant roster, "Drop votes" action (appending participant reset), and "Read-only" toggle switch in `apps/web/src/features/live/LiveSessionDialog.tsx`
- [ ] T022 [US5] Update `apps/web/src/features/live/GuestSession.tsx` to reactively lock grading and ballot inputs and display "The host made this session view-only" when `state.role === "view"`
- [ ] T023 [US5] Implement `RevokeSessionDialog` in `apps/web/src/features/live/RevokeSessionDialog.tsx` allowing owner to confirm revocation and optional relay snapshot purge
- [ ] T024 [US5] Implement `SessionsDashboard` in `apps/web/src/features/live/SessionsDashboard.tsx` with "Hosted Sessions" (Revoke, Open) and "Joined Sessions" (Reopen, "Remove from device" cache deletion)
- [ ] T025 [US5] Add E2E Playwright tests in `apps/web/e2e/live-session-admin.spec.ts` testing owner participant roster, dropping specific participant votes, and locking session to read-only

**Checkpoint**: User Stories 1, 2, and 5 work independently.

---

## Phase 6: User Story 3 - Anyone with a shared link can view the decision asynchronously (Priority: P2)

**Goal**: Use Nostr NIP-78 parameterized replaceable events (`kind 30078`, tag `["d", topic]`) to store AES-256-GCM sealed snapshots on public relays, allowing first-time visitors to bootstrap decision state while host is offline.

**Independent Test**: A clean browser profile with no prior cache opens a shared link while host is offline; fetches sealed snapshot from Nostr relays in <5s and renders full decision state.

### Tests for User Story 3
- [ ] T026 [P] [US3] Write unit and contract tests for NIP-78 replaceable snapshot publishing, subscribing, and unsealing in `plugins/share-inpage/test/nostr-nip78.test.ts`

### Implementation for User Story 3
- [ ] T027 [US3] Update `plugins/share-inpage/src/nostr.ts` to support NIP-78 parameterized replaceable events (`kind 30078`, tag `["d", topic]`) for publishing sealed snapshots and tombstones, and querying `kinds: [30078]` on subscribe
- [ ] T028 [US3] Update `plugins/share-inpage/src/host.ts` to publish sealed NIP-78 replaceable snapshot event on each snapshot broadcast (and tombstone on revocation)
- [ ] T029 [US3] Update `plugins/share-inpage/src/guest.ts` to initialize snapshot from sealed NIP-78 relay event if received before WebRTC data channel handshake completes
- [ ] T030 [US3] Add Playwright test in `apps/web/e2e/live-session-async.spec.ts` validating clean browser profile fetching snapshot asynchronously from Nostr relay while host is offline

**Checkpoint**: User Story 3 enables asynchronous snapshot rendezvous.

---

## Phase 7: User Story 4 - Collaborators save or restore the shared session into their own permanent workspace (Priority: P2)

**Goal**: "Save to my workspace" action in `GuestSession.tsx` allowing participants to fork the shared deliberation into an independent permanent project in their chosen store, preserving all author attributions, ratings, rankings, and history.

**Independent Test**: Gina views a shared session (live or offline), clicks "Save to my workspace", selects Local File store; a new project is created with all options, comments, and votes preserved.

### Tests for User Story 4
- [ ] T031 [P] [US4] Write unit test for session forking in `apps/web/src/features/live/fork-session.test.ts` verifying `snapshotToExport` and `restoreProject` preserve author attributions and history

### Implementation for User Story 4
- [ ] T032 [US4] Implement `ForkSessionDialog` in `apps/web/src/features/live/ForkSessionDialog.tsx` prompting user to select destination store (Local File, Local IndexedDB, Google Sheets, or Firestore) and calling `restoreProject`
- [ ] T033 [US4] Add "Save to my workspace" button in `apps/web/src/features/live/GuestSession.tsx` header (visible in live, offline, and ended states), opening `ForkSessionDialog` and redirecting to the new project
- [ ] T034 [US4] Add Playwright test in `apps/web/e2e/live-session-fork.spec.ts` proving a guest can fork a session into an independent local project

**Checkpoint**: All 5 user stories are functional and independently testable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, accessibility verification, and release preparation.

- [ ] T035 [P] Run automated accessibility audit on `SessionsDashboard`, `LiveSessionDialog`, `RevokeSessionDialog`, and `ForkSessionDialog` using axe in `apps/web/e2e/a11y.spec.ts`
- [ ] T036 [P] Create Changeset in `.changeset/restore-shared-sessions.md` marking minor bump for `@decisionator/share-inpage` and patch for `@decisionator/web`
- [ ] T037 Validate all 9 end-to-end scenarios in `specs/006-restore-shared-sessions/quickstart.md` pass against the test suite

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1; blocks all user stories.
- **User Story 1 (Phase 3 - MVP)**: Depends on Phase 2.
- **User Story 2 (Phase 4)**: Depends on Phase 2; integrates with US1 cached states.
- **User Story 5 (Phase 5)**: Depends on Phase 2; provides central management and admin controls for US1 & US2 sessions.
- **User Story 3 (Phase 6)**: Depends on Phase 2 & Phase 4; adds asynchronous relay fallback.
- **User Story 4 (Phase 7)**: Depends on Phase 2 & Phase 4; adds forking action to guest workspace.
- **Polish (Phase 8)**: Depends on all user stories being complete.

### Parallel Opportunities
- In Phase 1: T002 and T003 can run in parallel.
- In Phase 2: T004 and T005 can run in parallel.
- Tests marked `[P]` (T007, T011, T015, T016, T017, T026, T031) can be written in parallel before their respective implementations.
- User Stories 3 and 4 can run in parallel once Phases 3–5 complete.

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1: Host reverse lookup and reload recovery).
3. Validate User Story 1 independently with `apps/web/e2e/live-session-resume.spec.ts`.

### Incremental Delivery
1. Setup + Foundational $\rightarrow$ Foundation ready.
2. User Story 1 (P1) $\rightarrow$ Host can reload without dropping sessions (MVP).
3. User Story 2 (P1) $\rightarrow$ Returning guests never get empty errors when host is offline.
4. User Story 5 (P1) $\rightarrow$ Owners can view all shared sessions, inspect participants, drop votes, toggle read-only mode, and revoke links.
5. User Story 3 (P2) $\rightarrow$ First-time guests fetch snapshots asynchronously via Nostr relays.
6. User Story 4 (P2) $\rightarrow$ Guests can fork deliberations into their own permanent workspace.
