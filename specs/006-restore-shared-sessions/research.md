# Research: Restore Shared Sessions Across Devices and Disconnects

**Feature**: `006-restore-shared-sessions` | **Date**: 2026-10-11

## Findings & Architectural Decisions

### R1 — Host Recognition & Bi-directional Index

- **Problem**: When a project owner clicks a join link they previously shared (e.g., in a calendar invite or team chat), the app routes to `JoinLivePage` (`/join/:sessionId/:secret`) and treats them as an unauthenticated guest. The host tab attempts to connect to itself via WebRTC signaling, hanging and ultimately reporting "Could not reach the host".
- **Decision**: Introduce a bi-directional mapping in browser storage:
  - `deci.live.bySession.<sessionId>` $\rightarrow$ `projectKey` (e.g. `file:123` or `firestore:abc`).
  - Stored synchronously whenever `hostCredentialsFor(projectKey)` is invoked in `apps/web/src/features/live/live-config.ts`.
  - When `JoinLivePage` mounts, it checks `deci.live.bySession.<sessionId>`. If a match is found and the corresponding project exists in local/remote stores, the UI identifies the user as the owner.
  - The UI presents a clear action: **"You are hosting this decision. [Resume Live Session] or [Open Project]"** (with optional 3-second auto-redirect).
- **Alternatives considered**:
  - *Scan all projects on mount*: Slow and requires hitting the storage manager / Drive / Firestore APIs before rendering the join page.
  - *Embed host token in join link*: Violates security and simplicity; the join link should remain identical for all participants without revealing who is host.

---

### R2 — Host In-Flight Session Resilience (Tab Reload / Refresh)

- **Problem**: In `LiveShareProvider`, the active hosting session lives exclusively in React component state. If the host accidentally refreshes the browser (F5), closes the tab briefly, or the tab is discarded by OS memory management, the session drops. While `beforeunload` displays a browser prompt if guests are connected, users often proceed, dropping all WebRTC data channels.
- **Decision**: Persist an active session token in `sessionStorage["deci.live.activeHosting"]`:
  ```ts
  interface ActiveHostingRecord {
    projectRef: ProjectRef;
    projectTitle: string;
    sessionId: string;
    startedAt: string;
  }
  ```
  - When `LiveShareProvider` initializes, it checks `sessionStorage`. If an active session is found and was updated recently, it automatically re-invokes `start(target)`.
  - Combined with the existing 120-second exponential reconnect backoff in `LiveShareGuest`, guests automatically re-establish WebRTC connections within 1–3 seconds of the host reload without any lost votes.
- **Alternatives considered**:
  - *Background Service Worker WebRTC*: Standard Service Workers in browsers cannot maintain persistent WebRTC data channels or long-running WebSocket connections.
  - *localStorage instead of sessionStorage*: Risk of orphan background hosting if the user intentionally closed the window and opened a fresh session days later. `sessionStorage` scoped to the browser tab lifecycle is safer and cleaner.

---

### R3 — Guest Local Snapshot Caching (Offline / Disconnected Deliberation)

- **Problem**: When a guest reopens a shared link after a meeting, or if the host shuts their laptop, the guest is greeted by a 120-second spinner followed by "Could not reach the host". The guest cannot view the options, comments, or results, even though their browser received the full snapshot minutes earlier.
- **Decision**: Add a `live_sessions` object store to `DecisionatorDB` in IndexedDB (`apps/web/src/sync/db.ts`):
  ```ts
  interface CachedLiveSessionRecord {
    sessionId: string; // primary key
    secret: string;
    participantId: string;
    name: string;
    snapshot: ProjectSnapshot;
    rev: number;
    cachedAt: string;
  }
  ```
  - When `JoinLivePage` mounts with `:sessionId`, it immediately queries IndexedDB.
  - If a cached record exists, `GuestSession` renders immediately with a status badge: **"Host Offline (Cached) • Last synced [Time]"**.
  - In parallel, `guest.start()` dials the host via WebRTC and Nostr. If the host is online, the state seamlessly transitions to **"Live"** and updates the cache on any new snapshot.
  - If the host remains offline, the guest can still inspect all options, read comments, check the decision outcome, and export or fork the project.
- **Alternatives considered**:
  - *localStorage*: Stringified project snapshots with detailed comments and history can exceed the 5 MB localStorage quota if multiple sessions are cached. IndexedDB has ample capacity and is already wired via `idb`.

---

### R4 — Asynchronous Relay Snapshot via Nostr Replaceable Events (NIP-78)

- **Problem**: If a new guest (or someone on a second device) opens a shared link when the host is offline, they have no local IndexedDB cache and no direct WebRTC peer to connect to.
- **Decision**: Expand `@decisionator/share-inpage` signaling with NIP-78 Parameterized Replaceable Events:
  - When the host broadcasts a redacted snapshot to guests, it also seals the snapshot:
    $$\text{ciphertext} = \text{AES-GCM}(\text{signalKey}, \text{nonce}, \text{JSON}(\text{redactedSnapshot}), \text{aad} = \text{topic})$$
  - The host publishes this to configured Nostr relays as event `kind: 30078` with tag `["d", topic]`.
  - Relays persist only the latest event for each `d` tag.
  - When a guest arrives, `NostrSignaling` queries:
    `["REQ", subId, { kinds: [30078], "#d": [topic], limit: 1 }]`
  - Relays return the stored sealed snapshot immediately, even if the host tab is closed.
  - Guest unseals using `signalKey` derived from the URL fragment `secret`.
  - **Privacy**: The relay sees only the opaque hex `topic` and encrypted ciphertext. No credentials, author names, or options leak (Principle V compliant).
- **Alternatives considered**:
  - *Central HTTP server / Cloudflare KV*: Violates the serverless, static-app architecture of Deci.
  - *Keep purely ephemeral Nostr (kind 25050)*: Leaves shared links completely non-functional when the host is offline.

---

### R5 — "Restore to Workspace" (Project Ingestion & Forking)

- **Problem**: When a participant finishes a session, they can only "Save a copy" as a downloaded `.json` or `.xlsx` file, and then manually find the "Open file" button on the home page.
- **Decision**: Introduce a primary UI action: **"Save to my workspace"** inside `GuestSession.tsx`:
  - Uses `snapshotToExport(snapshot)` and `restoreProject(store, bundle)` from `features/project/project-file.ts`.
  - Presents a quick dialog allowing the user to select their destination store (Local file, Local IndexedDB, Google Drive, or Firestore).
  - Automatically re-appends all historical entries, preserved author attributions, option properties, and decision outcomes.
  - Redirects the user directly to `/p/:storeId/:newProjectId` as the owner of their independent fork.
- **Alternatives considered**:
  - *Automatic background saving*: Confusing to guests who just wanted to view a shared link; creating persistent projects should be an explicit user action.

---

### R6 — Protocol & Contract Compatibility

- **Live Share Protocol**: Wire version remains `proto: 3`. The NIP-78 snapshot publication is an enhancement in the transport layer (`NostrSignaling`), completely transparent to the link framing and host/guest message schema.
- **Storage Contract**: Uses existing `ProjectStore` 1.4.0 and `restoreProject` contract without modifications.

---

### R7 — Central Session Control, Link Revocation & Relay Retraction

- **Problem**: In the current system, session credentials live in `localStorage` under `deci.live.host.<projectKey>` with no user interface to enumerate them, revoke a shared link, or purge snapshots published to public relays. If a join link leaks or deliberations conclude, the owner cannot prevent access or purge the relay record. Furthermore, guests accumulate cached deliberations in IndexedDB with no way to review or clean them up.
- **Decision**:
  1. **Central Sessions Dashboard**: Add `/sessions` route (and a card in Settings $\rightarrow$ Live Sessions) that aggregates:
     - **Hosted Sessions**: Iterates `deci.live.host.*` entries, resolves project titles via storage manager, displays active/idle status, link, and active peer counts.
     - **Joined Sessions**: Queries IndexedDB `live_sessions` store, listing all deliberations attended on this browser, with last updated timestamps and assigned names.
  2. **Link Revocation Mechanism**:
     - When an owner clicks "Revoke link" on a hosted session:
       - The host marks the old `sessionId` as revoked in `deci.live.revoked.<sessionId> = true`.
       - Generates brand new `SessionCredentials` for the project.
       - Disconnects all currently attached peers with error frame: `{ t: "error", code: "session_revoked", message: "This session link has been revoked by the owner." }`.
       - Anyone subsequently opening the old link sees a clear revocation notice.
  3. **Relay Retraction (Tombstone)**:
     - When revoking or ending a session with relay retraction:
       - Host publishes a NIP-78 tombstone event to Nostr relays (`kind: 30078`, tag `["d", topic]`, content containing `sealed({ tombstone: true, revokedAt: Date.now() })`).
       - Because NIP-78 events are replaceable, this tombstone completely replaces the prior encrypted snapshot on all relays.
       - Alternatively, signs a NIP-09 deletion event (`kind: 5`) referencing the event id.
  4. **Guest Local Cache Management**:
     - Guests can click "Remove from device" in the Sessions Dashboard to permanently delete the cached session from IndexedDB.
- **Alternatives considered**:
  - *Hard-deleting host credentials without tombstone*: Leaves old snapshots on Nostr relays indefinitely, where anyone with the old URL fragment could still decrypt them. A tombstone guarantees relay state is purged.

---

### R8 — Live Participant Roster, Drop User Votes & Dynamic Read-Only Toggle

- **Problem**: During a live deliberation, a session host currently has minimal visibility and control over who has submitted input. The peer list in `LiveSessionDialog` displays raw peer identifiers or names without their submission state. If a participant makes an error, submits a joke vote, or spams inputs, the host has no targeted way to drop their vote short of a nuclear global reset. Furthermore, after deliberation concludes or during presentation phases, the host cannot dynamically freeze the session into read-only mode to prevent late edits without kicking participants out.
- **Decision**:
  1. **Interactive Live Participant Roster**:
     - The host tracks participant activity by combining peer connection status from `LiveShareHost` with the authoritative project state.
     - For each participant, the host calculates:
       - Display name and assigned numbered name.
       - Online / connected indicator.
       - Number of options graded (`gradeCount`).
       - Whether a ranking ballot has been cast (`hasBallot`).
     - Exposed in `LiveSessionDialog` as a clear roster with administrative actions.
  2. **Targeted Vote Dropping (Append-Only Participant Reset)**:
     - The project store's append-only journal natively supports scoped resets:
       `{ kind: "reset", scope: "participant", participantId, targets: ["grades", "ballots"] }`.
     - When the host clicks "Drop votes" for a participant:
       - The host appends a participant-scoped reset entry via `store.append(...)`.
       - The host coalescer generates a new snapshot and broadcasts it to all peers.
       - The target participant's grades and ballots are eliminated from the calculated tallies across all screens immediately.
       - **Audit Trail & Integrity**: Because this is an append-only entry rather than an in-place mutation, historical audit integrity is 100% preserved (Principle VI compliant).
  3. **Dynamic Read-Only Toggle (`setRole`)**:
     - `LiveRole` is typed as `"contribute" | "view"`.
     - In `LiveShareHost`, make `role` mutable and add `setRole(role: LiveRole)`.
     - When the host toggles "Read-only mode", `setRole("view")`:
       - Emits a fresh `snapshot` message containing `role: "view"`.
       - Rejects any subsequent guest submission with `{ t: "error", code: "read_only", message: "The host made this session view-only." }`.
     - In `LiveShareGuest`, update `state.role` whenever a `snapshot` arrives.
     - `GuestSession.tsx` uses `canContribute = live && state.role === "contribute"`. When `role === "view"`, guest controls (sliders, stars, drag-and-drop ballots, comments) are instantly locked, displaying the banner: *"The host made this session view-only."*
- **Alternatives considered**:
  - *Disconnect/kick participants instead of dropping votes*: Kicking disconnects WebRTC, but their previously submitted grades would linger in the project tally unless also reset. Targeted vote dropping cleans the tally while allowing the participant to remain in the room.
  - *Client-side-only UI lock for read-only*: Insufficient; malicious or outdated clients could still send submission frames over the data channel. The host policy layer must enforce read-only validation.

