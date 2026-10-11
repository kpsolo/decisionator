# Tasks: Restore Shared Sessions Across Devices and Disconnects

**Input**: Design documents from `specs/006-restore-shared-sessions/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/session-restore.md](./contracts/session-restore.md), [quickstart.md](./quickstart.md)  
**Tests**: Included. Constitution VII requires contract and unit tests before host, storage, and UI changes.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database schema expansion, protocol schemas, and routing entry points.

- [ ] T001 Register `live_sessions` object store in `DecisionatorDB` schema and upgrade handler with `lastOpenedAt` index in `apps/web/src/sync/db.ts`
- [ ] T002 [P] Define additive wire schemas in `plugins/share-inpage/src/protocol.ts`: `SnapshotUpdate` gains optional `role: LiveRoleSchema.optional()`, `Closing` gains optional `code: z.enum(["session_revoked", "ended"]).optional()`, and update `SessionCredentials` / crypto types for optional `hostKey`
- [ ] T003 [P] Add route `{ path: "/sessions", element: <SessionsDashboard /> }` to `apps/web/src/app/routes.tsx` and export navigation links in `apps/web/src/app/pages.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core session indexing, revocation tracking, and IndexedDB cache helpers that block user stories.

- [ ] T004 [P] Implement reverse session lookup helpers (`saveHostSessionIndex`, `resolveHostProject`), `relaySecret` generation in `hostCredentialsFor`, and revocation registry in `apps/web/src/features/live/live-config.ts`
- [ ] T005 [P] Implement IndexedDB cache access helpers (`cacheLiveSession`, `getCachedLiveSession`, `listCachedLiveSessions`, `deleteCachedLiveSession`, and LRU 30-session eviction) in `apps/web/src/sync/db.ts`
- [ ] T006 Write unit and contract tests for reverse index, `relaySecret` derivation, and cache helpers with LRU eviction in `apps/web/src/features/live/live-config.test.ts` and `apps/web/src/sync/db.test.ts`

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Project owner resumes hosting from a shared link or after reload (Priority: P1) 🎯 MVP

**Goal**: Recognize the host on `/join/:sessionId/:secret[/:hostKey]` via reverse index, and persist active hosting across tab reloads (F5) so guests reconnect without disruption.

**Independent Test**: An owner starts a live session, closes tab, and opens the join link in chat; recognized as owner, clicks "Resume Live Session", and re-hosts on the same credentials. When reloading the page, hosting auto-resumes within 5 seconds.

### Tests for User Story 1
- [ ] T007 [P] [US1] Write unit test for host reverse resolution and reload auto-resume in `apps/web/src/features/live/host-resume.test.ts`

### Implementation for User Story 1
- [ ] T008 [US1] Update `apps/web/src/features/live/LiveShareContext.tsx` to persist active hosting descriptor to `sessionStorage["deci.live.activeHosting"]` on `start()`, update heartbeat every 30 s, clear on `stop()` and revocation, and auto-resume hosting on mount if active hosting descriptor is present (< 1 hour)
- [ ] T009 [US1] Update `apps/web/src/features/live/GuestSession.tsx` (`JoinLivePage`) to check revocation first, then `resolveHostProject(sessionId)`: if matched and not revoked, render Host Resume card with "Resume Live Session" and "Open Project" actions, redirecting to `/p/:store/:id`
- [ ] T010 [US1] Add E2E Playwright test in `apps/web/e2e/live-session-resume.spec.ts` testing host page reload resilience and guest auto-reconnection with timing assertions (< 5000 ms)

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Returning guests view the session when the host is offline (Priority: P1)

**Goal**: Cache deliberations in IndexedDB (`live_sessions`) so returning guests immediately view decisions, options, comments, and outcomes even when the host is offline.

**Independent Test**: Gina joins a session, votes, and closes her tab. The host closes their tab. Gina re-opens the link; the workspace loads from IndexedDB in <1s displaying previous grades, ballots, and results with an offline banner.

### Tests for User Story 2
- [ ] T011 [P] [US2] Write unit test for guest offline cache lifecycle and in-flight submission drop error handling in `apps/web/src/features/live/guest-cache.test.ts`

### Implementation for User Story 2
- [ ] T012 [US2] Update `apps/web/src/features/live/GuestSession.tsx` to read `getCachedLiveSession(sessionId)` on mount: if found, render `GuestWorkspace` immediately (< 1000 ms) in cached offline mode with banner "Host offline • Last synced [Time]" while `guest.start()` dials in background
- [ ] T013 [US2] Update `apps/web/src/features/live/GuestSession.tsx` to persist received `welcome` and `snapshot` payloads to IndexedDB via `cacheLiveSession(...)`, disable submissions while offline with "Not connected to host", and surface "Host disconnected; submission not saved" on in-flight drops
- [ ] T014 [US2] Add E2E Playwright test step in `apps/web/e2e/live-session-resume.spec.ts` verifying guest offline viewing (< 1000 ms) and smooth upgrade to live when host reconnects

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 5 - Project owners and participants manage and revoke shared sessions (Priority: P1)

**Goal**: Central Sessions Dashboard (`/sessions`) and live session controls for owners to monitor shared decisions, inspect participant rosters, drop errant votes from specific participants, toggle live sessions between contribution and read-only modes, revoke access links via `closing` frames with `code: "session_revoked"`, and purge relay snapshots via tombstones. Guests can view their history and purge local cached data.

**Independent Test**: An owner hosts a live session with Gina and Tom. Tom submits an invalid ballot. The owner opens the participant roster, clicks "Drop votes" for Tom, and turns on "Read-only mode". Tom's ballot is cleared from the tally, Tom sees "The host reset your votes.", and both Gina's and Tom's screens immediately show "The host made this session view-only." with inputs disabled.

### Tests for User Story 5
- [ ] T015 [P] [US5] Write unit tests for link revocation closing frame (`code: "session_revoked"`), guest revocation transition, and cache purge in `plugins/share-inpage/test/revocation.test.ts`
- [ ] T016 [P] [US5] Write contract and unit tests for dynamic host role toggle (`setRole`), snapshot role broadcast, and Ack rejection (`code: "read_only"`, message: "The host made this session view-only.") in `plugins/share-inpage/test/host-role.test.ts`
- [ ] T017 [P] [US5] Write unit tests for `buildRoster(snapshot, guests, hostParticipantId)` and `participantVoteResets(participantId, round)` in `apps/web/src/features/live/participant-roster.test.ts` and `apps/web/src/features/history/reset-entries.test.ts`

### Implementation for User Story 5
- [ ] T018 [US5] Implement `revoke(reason?: string)` in `plugins/share-inpage/src/host.ts`: sends `{ t: "closing", code: "session_revoked", reason: "This session link has been revoked by the owner." }` to all links, closes transport, and rotates credentials
- [ ] T019 [US5] Implement `setRole(role: LiveRole)` in `plugins/share-inpage/src/host.ts`: broadcasts updated `role` in snapshot messages and rejects guest submissions with Ack `{ ok: false, code: "read_only", message: "The host made this session view-only." }` when `role === "view"`
- [ ] T020 [US5] Update `plugins/share-inpage/src/guest.ts` to handle `closing` with `code: "session_revoked"` (transitions to `revoked` status), update `this.state.role` upon receiving `snapshot` messages with `role`, and emit toast "The host reset your votes." when own grades/ballot are cleared by a newer reset entry
- [ ] T021 [US5] Extract `participantVoteResets(participantId, round)` into `apps/web/src/features/history/reset-entries.ts` (shared by `ResetDialog` and live panel) and implement `buildRoster()` in `apps/web/src/features/live/participant-roster.ts`
- [ ] T022 [US5] Implement interactive participant roster, "Drop votes" action (with confirmation dialog appending participant resets), and "Read-only" toggle switch in `apps/web/src/features/live/LiveSessionDialog.tsx`
- [ ] T023 [US5] Update `apps/web/src/features/live/GuestSession.tsx` to reactively lock grading and ballot inputs and display "The host made this session view-only." when `state.role === "view"`
- [ ] T024 [US5] Implement `RevokeSessionDialog` in `apps/web/src/features/live/RevokeSessionDialog.tsx` allowing owner to confirm revocation and optional relay snapshot purge (publishing tombstone)
- [ ] T025 [US5] Implement `SessionsDashboard` in `apps/web/src/features/live/SessionsDashboard.tsx` with "Hosted Sessions" (Revoke, Open, live peer count for current tab) and "Joined Sessions" (Reopen, "Remove from device" cache deletion)
- [ ] T026 [US5] Add E2E Playwright test in `apps/web/e2e/live-session-revocation.spec.ts` testing owner revoking link, connected guest ejection within 1 s (< 1000 ms), cache purge, and old link blocking
- [ ] T027 [US5] Add E2E Playwright test in `apps/web/e2e/live-session-admin.spec.ts` testing owner participant roster, dropping specific participant votes (< 1000 ms tally update, guest toast), and locking session to read-only (< 1000 ms input lock)

**Checkpoint**: User Stories 1, 2, and 5 work independently.

---

## Phase 6: User Story 3 - Anyone with a shared link can view the decision asynchronously (Priority: P2)

**Goal**: Use Nostr NIP-78 parameterized replaceable events (`kind 30078`, tag `["d", topic]`) signed by the host Schnorr key to store AES-256-GCM sealed snapshots on public relays, allowing first-time visitors to bootstrap decision state while host is offline, while preventing forged records.

**Independent Test**: A clean browser profile with no prior cache opens a shared link while host is offline; fetches sealed snapshot from Nostr relays in <5s and renders full decision state. Forged records from other link holders are ignored.

### Tests for User Story 3
- [ ] T028 [P] [US3] Write unit and contract tests for host-signed NIP-78 replaceable snapshot publishing (`kind 30078`), Schnorr signature verification, key pinning, and tombstone handling in `plugins/share-inpage/test/nostr-nip78.test.ts`

### Implementation for User Story 3
- [ ] T029 [US3] Update `plugins/share-inpage/src/nostr.ts` to support NIP-78 parameterized replaceable events (`kind 30078`, tag `["d", topic]`) signed by the host Schnorr key, and query `authors: [hostKey]` on subscribe
- [ ] T030 [US3] Update `plugins/share-inpage/src/host.ts` to derive `hostKeyPair` from `relaySecret`, include `hostKey` in `welcome` snapshot, publish signed NIP-78 snapshot on broadcast (≤ 1 per 2 s), and publish signed tombstone on revocation purge
- [ ] T031 [US3] Update `plugins/share-inpage/src/guest.ts` to extract `hostKey` from link (or pin from first welcome), verify Schnorr signature before unsealing NIP-78 events, and initialize snapshot if received before WebRTC connects
- [ ] T032 [US3] Update `apps/web/src/features/live/GuestSession.tsx` to explain unreachable links ("This session can't be reached right now...") and malformed links ("This link is incomplete or damaged.")
- [ ] T033 [US3] Add Playwright test in `apps/web/e2e/live-session-async.spec.ts` validating clean browser profile fetching snapshot asynchronously from Nostr relay (< 5000 ms) and rejecting forged events

**Checkpoint**: User Story 3 enables verifiable asynchronous snapshot rendezvous.

---

## Phase 7: User Story 4 - Collaborators save or restore the shared session into their own permanent workspace (Priority: P2)

**Goal**: "Save to my workspace" action in `GuestSession.tsx` allowing participants to fork the shared deliberation into an independent permanent project in their chosen store, preserving all author attributions, ratings, rankings, and history.

**Independent Test**: Gina views a shared session (live or offline), clicks "Save to my workspace", selects Local File store; a new project is created with all options, comments, and votes preserved.

### Tests for User Story 4
- [ ] T034 [P] [US4] Write unit test for session forking in `apps/web/src/features/live/fork-session.test.ts` verifying `snapshotToExport` and `restoreProject` preserve author attributions and history

### Implementation for User Story 4
- [ ] T035 [US4] Implement `ForkSessionDialog` in `apps/web/src/features/live/ForkSessionDialog.tsx` prompting user to select destination store (Local File, Local IndexedDB, Google Sheets, or Firestore) and calling `restoreProject`
- [ ] T036 [US4] Add "Save to my workspace" button in `apps/web/src/features/live/GuestSession.tsx` header (visible in live, offline, and ended states), opening `ForkSessionDialog` and redirecting to the new project
- [ ] T037 [US4] Add Playwright test in `apps/web/e2e/live-session-fork.spec.ts` proving a guest can fork a session into an independent local project

**Checkpoint**: User Stories 1 through 5 are functional and independently testable.

---

## Phase 8: User Story 6 - The owner's own agent can inspect and propose session moderation (Priority: P3)

**Goal**: Expose live session state and moderation proposals to the owner's AI agent through `get_live_session` and `propose_moderation` (agentic API v1.2.0), resolving Staged Compliance deferral D1.

**Independent Test**: The owner grants their agent access with `moderate_session`. The agent reads the roster, sees Tom's 1-star ballot, and proposes "Drop votes for Tom". The owner accepts the proposal in the live panel; the reset entries are recorded and attributed to the owner with the agent logged in audit trail.

### Tests for User Story 6
- [ ] T038 [P] [US6] Write contract tests for `get_live_session` and `propose_moderation` (MCP tool and REST) in `packages/node/test/agent-api-live-session.test.ts` testing schema parity, pseudonymization, `moderate_session` permission enforcement, and proposal lifecycle

### Implementation for User Story 6
- [ ] T039 [US6] Implement `get_live_session` and `propose_moderation` endpoints and MCP tools in `packages/node/src/agent-api/mcp.ts` and `packages/node/src/agent-api/rest.ts`
- [ ] T040 [US6] Add live session state bridge and pending `ModerationProposal` queue in `packages/node/src/agent-api/state.ts` and audit logging (`agent_moderation_proposed`, `agent_moderation_accepted`, `agent_moderation_dismissed`)
- [ ] T041 [US6] Update `apps/web/src/features/live/LiveSessionDialog.tsx` to display pending moderation proposals from agents with "Accept" and "Dismiss" buttons

**Checkpoint**: Staged Compliance deferral D1 is resolved; Principle IV satisfied with full agent API parity.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, accessibility verification, and release preparation.

- [ ] T042 [P] Run automated accessibility audit on `SessionsDashboard`, `LiveSessionDialog`, `RevokeSessionDialog`, and `ForkSessionDialog` using axe in `apps/web/e2e/a11y.spec.ts`
- [ ] T043 [P] Create Changeset in `.changeset/restore-shared-sessions.md` marking minor bumps for `@decisionator/share-inpage` (3.1.0) and `@decisionator/node` (1.2.0), and patch for `@decisionator/web`
- [ ] T044 Validate all 10 end-to-end scenarios in `specs/006-restore-shared-sessions/quickstart.md` pass against the test suite

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1; blocks all user stories.
- **User Story 1 (Phase 3 - MVP)**: Depends on Phase 2.
- **User Story 2 (Phase 4)**: Depends on Phase 2; integrates with US1 cached states.
- **User Story 5 (Phase 5)**: Depends on Phase 2; provides central management and admin controls for US1 & US2 sessions.
- **User Story 3 (Phase 6)**: Depends on Phase 2 & Phase 4; adds verifiable asynchronous relay fallback.
- **User Story 4 (Phase 7)**: Depends on Phase 2 & Phase 4; adds forking action to guest workspace.
- **User Story 6 (Phase 8)**: Depends on Phase 5; exposes live moderation to agent API, resolving Staged Compliance D1.
- **Polish (Phase 9)**: Depends on all user stories being complete.

### Parallel Opportunities
- In Phase 1: T002 and T003 can run in parallel.
- In Phase 2: T004 and T005 can run in parallel.
- Tests marked `[P]` (T007, T011, T015, T016, T017, T028, T034, T038) can be written in parallel before their respective implementations.
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
5. User Story 3 (P2) $\rightarrow$ First-time guests fetch verifiable snapshots asynchronously via Nostr relays.
6. User Story 4 (P2) $\rightarrow$ Guests can fork deliberations into their own permanent workspace.
7. User Story 6 (P3) $\rightarrow$ Agents can inspect sessions and propose moderation, resolving D1.
