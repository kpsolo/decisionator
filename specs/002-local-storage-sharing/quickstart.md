# Quickstart: Local & Universal Storage with In-Page Sharing

This guide covers runnable end-to-end validation scenarios for the Local File storage, Firestore cloud integration, and In-Page Local Sharing.

---

## Scenario 1: Local-First Decision Making with File Storage

**Objective**: Verify creating, editing, and saving a decision project completely offline to a local file.

1. **Launch App**: Open Deci web app in a browser without any cloud account connected.
2. **Create Decision**: Navigate to `#/new`. Enter Title "Team Lunch Choice", add 3 options.
3. **Save to File**: Click "Save Project". Observe browser file picker prompt (`team-lunch-choice.decisionator.json`).
4. **Vote Offline**: Grade Option 1 with 5 stars. Verify change streams directly to the local file.
5. **Reopen File**: Refresh or restart browser. Click "Open from File", select the saved JSON file.
6. **Expected Outcome**: All options and votes reload with 100% fidelity.

---

## Scenario 2: Active Storage Provider Switching & Lossless Migration

**Objective**: Verify activating Firestore and moving a project between Local File and Firestore.

1. **Activate Firestore**: Open Settings (`#/settings`), enter Firebase project configuration, and set "Active Storage" to **Firestore**.
2. **Open Local Project**: Load an existing local file project.
3. **Migrate Project**: Open "Move / Export" dialog. Select target store "Firestore".
4. **Execute Move**: Click "Transfer to Firestore".
5. **Expected Outcome**: A new Firestore project reference is created (`/p/firestore/<id>`), and all options, votes, and outcomes are present.

---

## Scenario 3: Real-Time Firestore Sync

**Objective**: Verify collaborative voting updates across multiple browsers in real time.

1. **Open Session**: Open `/p/firestore/<id>` in Browser Window A and Browser Window B.
2. **Cast Vote**: In Window A, submit a ballot ranking Option 1 first.
3. **Expected Outcome**: Window B reflects the updated tally and grade within 1 second without page reload.

---

## Scenario 4: In-Page Local Live Sharing

**Objective**: Verify peer-to-peer voting coordinated directly by the host browser tab.

1. **Host Session**: In Host Window A (editing a local file project), click "Start In-Page Live Session".
2. **Join Session**: Copy the join link and open it in Guest Window B.
3. **Peer Vote**: From Guest Window B, submit a vote.
4. **Expected Outcome**: Host Window A receives the vote over WebRTC DataChannel / BroadcastChannel, appends it to the local file, and broadcasts the updated snapshot back to Guest Window B.
