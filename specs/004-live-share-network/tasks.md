# Tasks: Live Sessions Across Devices (spec revision 2026-10-07)

**Input**: [spec.md](./spec.md) (revised), [plan.md](./plan.md),
[contracts/live-share.md](./contracts/live-share.md)

The original implementation is complete. These tasks close the gaps the spec revision exposed:

- one behaviour that is missing: duplicate display names (FR-003, US1 scenario 5);
- acceptance scenarios that the code satisfies but no test checks.

Format: `- [ ] T### [P?] [Story] Description`. `[P]` means it can run in parallel with other
`[P]` tasks in the same phase (different files, no dependency).

## Phase 1: Unique display names (US1, FR-003) 🎯

Two guests who both type "Gina" are indistinguishable today: in the owner's list of connected
people, next to comments, and in results. The host already sends back a `name` in `welcome`, but
the guest ignores it and shows what the user typed.

- [x] T001 [US1] Update `specs/004-live-share-network/contracts/live-share.md`.
  - Host rules: a new rule says the host gives a guest a name that no other connected
    participant uses. It appends the lowest free number (`"Gina"` → `"Gina 2"`), comparing
    names trimmed and case-insensitively. The name stays with that `participantId` for the rest
    of the session, so reconnecting keeps `"Gina 2"`.
  - Guest rules: the guest shows the `welcome.name` it receives.
  - Bump the contract to 2.1.0 and add a Changelog row. The wire `proto` stays `2`, because no
    message shape changes and an older guest still works (it just shows the name it typed).
- [x] T002 [US1] Write the failing tests first, in `plugins/share-inpage/test/host-guest.test.ts`:
  - Alice and a second guest both say hello as "Gina": the second gets `welcome.name` "Gina 2",
    and `getState().guests` lists "Gina" and "Gina 2".
  - "gina " (lowercase, trailing space) also becomes "Gina 2"-style unique.
  - The second guest reconnects and is still "Gina 2".
  - Their grades are appended with `displayName` "Gina 2".
- [x] T003 [US1] Implement in `plugins/share-inpage/src/host.ts`. On `hello`, resolve
  `state.name` against the names of the other participants that have open links. Remember the
  result in a `participantId → name` map next to `joinedAt`, so a reconnect reuses it.
  `appendFor` and the roster already read `state.name`.
- [x] T004 [US1] In `plugins/share-inpage/src/guest.ts`, add `name` to `LiveGuestState` and
  set it from `welcome`.
- [x] T005 [US1] In `apps/web/src/features/live/GuestSession.tsx`, show `state.name ?? displayName`
  in "You're …" and use it as `byName` on pending comments.
- [x] T006 [US1] Add a step to `apps/web/e2e/live-session.spec.ts`. A second guest page joins
  as "Gina" and sees "You're Gina 2". The host dialog lists both "Gina" and "Gina 2".
- [x] T007 [P] [US1] Add a changeset in `.changeset/live-share-unique-names.md`: minor for
  `@decisionator/share-inpage`, patch for the web app.

**Checkpoint**: `pnpm vitest run plugins/share-inpage` and the live e2e pass. US1 scenario 5
is demonstrated.

## Phase 2: Tests for acceptance scenarios that exist but are unchecked

Each task proves a scenario the revised spec now states. If a test fails, fix the behaviour, not
the test.

- [x] T008 [P] [US1] Add a unit test in `plugins/share-inpage/test/host-guest.test.ts` for
  US1 scenario 6: while voting is closed, a guest's grade and comment are accepted (`ack ok`)
  and a ballot is refused with `voting_closed`.
- [x] T009 [P] [US1] Add a unit test in `plugins/share-inpage/test/host-guest.test.ts` for
  US1 scenario 7: a host with `maxLinks: 2` and a third guest. The third guest ends in `failed`
  with "This session is full." and the roster still has 2 guests.
- [x] T010 [US2] Add a step to `apps/web/e2e/live-session.spec.ts` for US2 scenario 3 and
  US1 scenario 6. With the guest connected, the owner closes voting. Within 1 s the guest's
  ballot is locked with "Voting is closed.", and a grade the guest gives afterwards still
  reaches the owner. (The original wording had the owner add an option; the app cannot add
  options after creation, so the spec scenario was corrected.)
- [x] T011 [US2] Add a step to `apps/web/e2e/live-session.spec.ts` for US2 scenario 4. With
  the guest connected, `host.close({ runBeforeUnload: true })` raises a `beforeunload` dialog.
  Dismiss it once and check the guest is still "Live". Then accept it and check the guest sees
  "The host closed their tab." Run this step last: it ends the host page.
- [x] T012 [US3] Add a step to `apps/web/e2e/live-session.spec.ts` for US3 scenarios 2 and 4.
  From the guest page, fire 30 grade changes in one `page.evaluate` call. Check that a "Not
  saved" toast says "Too many changes at once. Try again shortly." and that the stars the guest
  sees match the last grade the host shows for that option.
- [x] T013 [P] [US3] Add a test in `apps/web/src/features/project/project-file.test.ts` for
  US3 scenario 7.
  - Feed a snapshot through `redactSnapshotFor` (live results off, one hidden comment, two
    voters), then `snapshotToExport`.
  - Check that `readProjectFile` accepts the result.
  - Check the hidden comment's body is empty.
  - Check only the guest's own ballot is present.
- [x] T014 [P] [US3] Make sure the existing give-up test in
  `plugins/share-inpage/test/host-guest.test.ts` checks the exact message for US3 scenario 6
  ("The host is no longer reachable."). Add the assertion if it is missing.

Found while doing Phase 2, and fixed:

- [x] T017 [US1] `plugins/share-inpage/src/link.ts`: keep messages that arrive before the first
  listener is attached. Before this, a guest turned away from a full session lost the
  "session full" message and kept retrying until it gave up with "Could not reach the host".
  There is a test in `plugins/share-inpage/test/transport.test.ts`.
- [x] T018 [US2] `apps/web/src/features/live/GuestSession.tsx`: leave the session on `pagehide`.
  Without it, a guest who closes their tab stays in the owner's list of connected people
  until the heartbeat times out (about 15 s). This is now FR-006 and is covered by T006.

**Checkpoint**: every acceptance scenario in spec.md maps to at least one test (see the
traceability table below).

## Phase 3: Documentation

- [x] T015 [P] Add row 12 to the "Findings that drove the design" table in
  `specs/004-live-share-network/plan.md`: "Guests with the same name were indistinguishable" →
  "Host assigns unique display names (contract 2.1.0)".
- [x] T016 [P] Update the Test kit section of `specs/004-live-share-network/contracts/live-share.md`
  to list unique names, closed-voting grades and session-full in the unit-test bullet.

## Traceability

| Spec scenario | Test |
|---|---|
| US1 Independent Test, 1, 2, 3 | e2e `live-session.spec.ts` (grade / comment steps) |
| US1 4 | e2e reload step; unit "same identity when they rejoin" |
| US1 5 | T002, T006 |
| US1 6 | T008, T010; unit `voting_closed` |
| US1 7 | T009, T017 |
| US2 Independent Test, 1 | e2e "session survives the host navigating" |
| US2 2 | e2e dialog roster (extended by T006) |
| US2 3 | T010 |
| US2 4 | T011 |
| US2 5 | e2e "ending the session tells the guest" |
| US3 1, 3 | e2e grade step; `disabledReason` checked after end |
| US3 2, 4 | T012; unit `rate_limited`, `store_failed` |
| US3 5 | e2e "ending the session tells the guest" |
| US3 6 | T014 |
| US3 7 | T013 |

## Dependencies

- T001 → T002 → T003 → T004 → T005 → T006. T007 can be done any time in Phase 1.
- Phase 2 tasks don't depend on Phase 1, except T011, which must stay the last e2e step after
  T006, T010 and T012.
- Phase 3 comes after T001.
