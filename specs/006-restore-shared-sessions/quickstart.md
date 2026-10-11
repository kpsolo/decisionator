# Quickstart & Validation Guide: Restore Shared Sessions

**Feature**: `006-restore-shared-sessions` | **Date**: 2026-10-11

This guide details end-to-end validation scenarios for testing session restoration across devices and disconnects.

---

## Prerequisites

1. Node.js 24 LTS and pnpm 10 installed.
2. Clean test environment:
   ```bash
   pnpm install
   pnpm build
   ```

---

## Scenario 1: Host Re-Opening Join Link (Self-Recognition)

**Goal**: Verify that an owner opening their own shared join link is recognized as the host rather than failing as a guest.

1. **Start host**:
   - In browser profile A, open Deci (`http://localhost:5173/`).
   - Create a project: "Trip to Kyoto" with 3 options.
   - Click **Live Session** $\rightarrow$ **Start live session**.
   - Copy the join link (e.g. `http://localhost:5173/#/join/sess123/sec456`).
2. **Close and reopen**:
   - Close the project tab.
   - In the same browser, open the copied join link directly in the address bar.
3. **Expected outcome**:
   - The page displays: *"You are hosting this decision: Trip to Kyoto"*.
   - A button **Resume Live Session** is visible.
   - Clicking **Resume Live Session** re-establishes hosting on the exact same `sessionId`, and the live indicator shows in the app header.

---

## Scenario 2: Host Tab Reload Resilience (Zero Guest Interruption)

**Goal**: Verify that a host refreshing their browser tab automatically recovers the session, and connected guests reconnect seamlessly.

1. **Setup session with guest**:
   - Browser A (Host): Hosting "Trip to Kyoto".
   - Browser B (Guest): Joins as "Gina", grades option 1 with 5 stars.
2. **Reload host**:
   - In Browser A, press F5 (Reload page).
3. **Expected outcome**:
   - Browser A reloads directly to the project and immediately resumes hosting.
   - Browser B briefly shows a reconnecting indicator, then re-establishes connection within 3 seconds.
   - Browser B's grade (5 stars) remains intact; Browser A's connected guest count returns to 1.

---

## Scenario 3: Guest Offline Deliberation (Cached State)

**Goal**: Verify that a guest can view the latest decision state and results when the host shuts down.

1. **Participate in session**:
   - Browser A (Host) hosts a session.
   - Browser B (Guest) joins as "Gina", votes on options, and sees the results.
2. **Host disconnects**:
   - Browser A closes the tab.
   - Browser B closes the tab.
3. **Guest returns**:
   - Browser B opens the join link `#/join/sess123/sec456`.
4. **Expected outcome**:
   - In under 1 second, Browser B renders the full decision workspace.
   - A status banner shows: *"Host is offline • Showing session from [Time]"*.
   - All options, Gina's grades, ballots, and decision results are fully viewable.
   - Submissions are disabled with an explanation: *"Not connected to host"*.

---

## Scenario 4: Asynchronous Relay Snapshot Bootstrap

**Goal**: Verify that a new visitor can fetch the decision state from public relays without an active host tab.

1. **Host publishes to relays**:
   - Host runs a decision session, grades options, and decides the outcome.
   - Host closes the browser tab.
2. **New visitor opens link**:
   - Open Browser C (Incognito / clean profile with zero cached data).
   - Navigate to the join link `#/join/sess123/sec456`.
3. **Expected outcome**:
   - Browser C queries Nostr relays for the sealed snapshot (NIP-78 `kind 30078`).
   - Browser C decrypts the snapshot using the URL fragment secret.
   - The decision state, options, and results load within 5 seconds.

---

## Scenario 5: "Restore to Workspace" (Project Forking)

**Goal**: Verify that any participant can fork a shared session into an independent, permanent workspace project.

1. **View session**:
   - In Browser B (Guest), view the shared session.
   - Click **Save to my workspace** in the header.
   - Select **Local File** or **Local Store** as the destination.
2. **Expected outcome**:
   - A new project is created in the chosen store.
   - The browser navigates to `/p/file/<new-id>`.
   - The new project contains 100% of the options, grades, comments (with author attribution), and decision outcomes.
   - Changes in this new project do not affect the original host session.

---

## Scenario 6: Revoking a Link & Purging Relay Snapshots

**Goal**: Verify that the owner can revoke a shared session link, ejecting connected peers and permanently preventing access through the old URL.

1. **Host revokes link**:
   - In Browser A (Host), navigate to the **Sessions Dashboard** (`#/sessions`) or open the Live Share dialog.
   - Click **Revoke Link** on "Trip to Kyoto", and check "Purge from relays".
2. **Guest receives ejection**:
   - Connected Browser B (Guest) immediately sees an alert: *"This session link has been revoked by the owner."* and controls are disabled.
3. **Attempt access with old link**:
   - Open Browser C, navigate to the old link `#/join/sess123/sec456`.
4. **Expected outcome**:
   - Browser C immediately displays: *"This session link has been revoked by the owner."*
   - Nostr relays return the tombstone, so no snapshot data is displayed.
   - Browser A can start a fresh session with a new join link whenever ready.

---

## Scenario 7: Managing Joined Sessions & Clearing Cache

**Goal**: Verify that a participant can view all joined sessions in their dashboard and delete cached deliberations.

1. **Open dashboard**:
   - In Browser B, navigate to the **Sessions Dashboard** (`#/sessions`).
   - Switch to the **Joined Sessions** tab.
2. **View deliberations**:
   - The list shows "Trip to Kyoto", the date joined, and assigned name ("Gina").
3. **Purge local cache**:
   - Click **Remove from device**.
4. **Expected outcome**:
   - The session is deleted from IndexedDB.
   - It no longer appears in the Joined Sessions list.

---

## Scenario 8: Host Dropping Specific Participant Votes in Real Time

**Goal**: Verify that an owner can drop grades and ballots from a specific participant, immediately recalculating the tally and broadcasting the update to all peers.

1. **Setup session with multiple participants**:
   - Browser A (Host): Hosts "Team Lunch".
   - Browser B (Guest "Gina"): Grades Option 1 with 5 stars, Option 2 with 2 stars.
   - Browser C (Guest "Tom"): Submits joke 1-star grades on all options and casts a ballot.
2. **Inspect participant roster**:
   - In Browser A, open the Live Session dialog and view the **Participants** tab.
   - Both Gina and Tom are listed as online, with Tom showing "2 grades submitted, ballot cast".
3. **Drop Tom's votes**:
   - Host clicks **"Drop votes"** on Tom's row.
4. **Expected outcome**:
   - A participant-scoped reset is appended to the project store.
   - Tom's grades and ballot are instantly removed from the project scores.
   - Browser A, Browser B, and Browser C instantly reflect the updated tally (Tom's 1-star ratings no longer skew the result).
   - Tom's screen displays a notice: *"Your votes were reset by the host"*, allowing Tom to re-grade if appropriate.
   - Historical audit integrity is intact: prior snapshots can still be audited via the append-only journal.

---

## Scenario 9: Dynamic Read-Only Session Toggle

**Goal**: Verify that toggling a session to read-only locks inputs for all connected guests within 1 second and rejects late submissions.

1. **Active deliberation**:
   - Browser A (Host) and Browser B (Guest) are connected.
   - Browser B can freely adjust rating sliders and cast ballots.
2. **Host engages read-only mode**:
   - In Browser A, open Live Session controls and toggle **"Read-only mode"** ON.
3. **Expected outcome on guest**:
   - Within 1 second, Browser B's voting controls, sliders, and ballot ranking UI are locked.
   - A banner appears across the top: *"The host made this session view-only."*
   - If an outdated or adversarial client sends a submission frame, the host returns error: `read_only`.
4. **Host re-enables contribution**:
   - In Browser A, toggle **"Read-only mode"** OFF ("Allow contributions").
   - Browser B's inputs are unlocked immediately and the banner disappears.

---

## Automated Test Suites

Run the automated contract and end-to-end suites:

```bash
# Unit & contract tests
pnpm vitest run plugins/share-inpage
pnpm vitest run apps/web
# Playwright E2E tests
pnpm --filter @decisionator/web test:e2e e2e/live-session.spec.ts
```


