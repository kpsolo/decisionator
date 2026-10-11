# Contract: Session Restoration & Asynchronous Snapshot Transport — v3.1.0

Package: `@decisionator/share-inpage` & `@decisionator/web`

Extends [Live Share Contract v3.0.0](../../004-live-share-network/contracts/live-share.md). Wire protocol `proto: 3` remains unchanged; this contract specifies the asynchronous relay persistence, offline caching, and host-resumption extensions.

---

## 1. Asynchronous Signaling: NIP-78 Sealed Snapshot

### 1.1 Specification

To allow late-joining guests and disconnected participants to access decision state without an open host tab, the Nostr signaling transport is augmented with NIP-78 Parameterized Replaceable Events.

- **Event Kind**: `30078`
- **Identifier Tag**: `["d", <topic>]`
- **Topic Tag**: `["t", <topic>]`
- **Expiration**: Standard relay replacement policy (new event with same pubkey and `d` tag replaces the old event).

### 1.2 Host Publishing Rule

1. Whenever `LiveShareHost` broadcasts a fresh snapshot (coalesced within 30 ms), it produces a sealed snapshot blob:
   ```ts
   payload = seal(signalKey, nonce12, JSON.stringify(redactedSnapshot), topic);
   ```
2. The host signs an ephemeral Nostr event of kind `30078` containing `payload` in `content` and sends it to all configured Nostr relays.
3. The event uses a stable Schnorr keypair derived from `deriveSessionKeys(credentials).signalKey` so all updates from this host share the same `pubkey`, ensuring relays replace old snapshots cleanly.

### 1.3 Guest Retrieval Rule

1. When `joinSession(...)` initiates, `NostrSignaling` immediately issues a subscription filter:
   ```json
   ["REQ", "<subId>", { "kinds": [30078], "#d": ["<topic>"], "limit": 1 }]
   ```
2. Upon receiving an `EVENT` with `kind: 30078`, the guest attempts to unseal the `content`:
   ```ts
   snapshot = JSON.parse(unseal(signalKey, event.content, topic));
   ```
3. If valid and `snapshot.rev > currentRev`, the guest state machine updates its snapshot and notifies listeners immediately.
4. If WebRTC connects later with a higher `rev`, the live host's update takes precedence.

---

## 2. Host Reverse Resolution & Auto-Resume

### 2.1 Storage Mapping

The host maintains a reverse lookup index in browser `localStorage`:
- **Key**: `deci.live.bySession.<sessionId>`
- **Value**: `${projectRef.store}:${projectRef.id}`

### 2.2 Route Interception

When navigating to `/join/:sessionId/:secret`:
1. The route inspects `localStorage.getItem("deci.live.bySession." + sessionId)`.
2. If found, the application validates that the referenced project exists.
3. If confirmed, the user is recognized as the **Host**, and the page presents:
   - Action A: **Resume Live Session** (restarts hosting with the existing credentials).
   - Action B: **Open Project** (navigates to `/p/:store/:id`).
4. If not found, the application proceeds with the standard **Guest** join flow.

### 2.3 Tab Reload Resilience

In `LiveShareProvider`:
1. On hosting start, store in `sessionStorage["deci.live.activeHosting"]`:
   ```json
   {
     "store": "file",
     "id": "project-123",
     "title": "Roadmap Decision",
     "sessionId": "<sessionId>",
     "timestamp": 1775899200000
   }
   ```
2. On `LiveShareProvider` mount, if `activeHosting` exists and `Date.now() - timestamp < 3600000` (1 hour):
   - Automatically trigger `start({ store, projectRef, projectTitle })`.
   - Connected guests reconnect automatically via their built-in WebRTC retry backoff.
3. When the user clicks **End Session**, `sessionStorage.removeItem("deci.live.activeHosting")` is called.

---

## 3. Guest Local Offline Cache

### 3.1 IndexedDB Store: `live_sessions`

The guest browser caches deliberations in `DecisionatorDB` under object store `live_sessions`:

```ts
interface CachedLiveSessionRecord {
  sessionId: string;
  secret: string;
  participantId: string;
  name: string;
  role: "contribute" | "view";
  rev: number;
  snapshot: ProjectSnapshot;
  cachedAt: string;
}
```

### 3.2 Offline Lifecycle

1. On `JoinLivePage` load, query `live_sessions.get(sessionId)`.
2. If found, render the workspace immediately with:
   - Status: `Host Offline (Cached)`.
   - Interaction: Read-only (voting and comments disabled with explanatory message).
   - Actions: **Reconnect**, **Save a copy**, **Restore to my workspace**.
3. In the background, `LiveShareGuest` attempts network connection.
4. On `welcome` or `snapshot`, write the updated state to `live_sessions`.

---

## 4. "Restore to Workspace" (Project Ingestion)

### 4.1 Invocation

Available to any viewing participant (live, offline, or from relay) via the workspace header.

### 4.2 Behavior

1. Converts `snapshot` to an export bundle:
   ```ts
   const bundle = snapshotToExport(snapshot);
   ```
2. Resolves the target `ProjectStore` selected by the user.
3. Invokes `restoreProject(targetStore, bundle)`:
   - Re-creates project meta, title, description, and options.
   - Re-appends all grades, comments, rankings, and properties with original author attribution (`onBehalfOf`).
   - Re-appends decision outcomes and history.
4. Navigates the user to `/p/:targetStore/:newId`.

---

## 5. Security & Privacy Guarantees (Principle V)

1. **Zero Metadata Leakage**: Nostr relays store encrypted snapshots under the opaque `topic` derived from HKDF. They receive neither `sessionId`, `secret`, project title, nor participant identities.
2. **Local Identity Isolation**: Device secrets and private keys never leave the browser.
3. **No Unredacted Bleed**: Asynchronous snapshots sent to relays are redacted per live-share policy (owner-only drafts, tokens, and credentials stripped).

---

## 6. Session Control, Revocation & Relay Retraction

### 6.1 Revocation Procedure

When the project owner clicks "Revoke Link":
1. **Local Invalidation**:
   - Store revocation flag: `localStorage.setItem("deci.live.revoked." + oldSessionId, JSON.stringify({ revokedAt: new Date().toISOString() }))`.
   - Remove reverse mapping: `localStorage.removeItem("deci.live.bySession." + oldSessionId)`.
   - Rotate host credentials: Generate fresh `SessionCredentials` for `projectKey` and store under `deci.live.host.<projectKey>`.
2. **Connected Peer Ejection**:
   - For all active WebRTC links attached to the revoked session, the host immediately sends:
     ```json
     { "t": "error", "code": "session_revoked", "message": "This session link has been revoked by the owner." }
     ```
   - Closes the WebRTC data channels and peer connections.
3. **Relay Retraction (Tombstone)**:
   - Host signs and publishes a NIP-78 event (`kind: 30078`) to all configured relays with tag `["d", oldTopic]` and sealed content:
     ```json
     { "tombstone": true, "revokedAt": 1775899200000 }
     ```
   - Relays replace the previous encrypted snapshot with the tombstone event.
4. **Guest Revocation Handling**:
   - Guests receiving `session_revoked` or unsealing a tombstone transition to the `revoked` state.
   - The UI disables interaction and displays: *"This session link has been revoked by the owner."*
   - Removes the revoked session from IndexedDB `live_sessions`.

### 6.2 Central Sessions Dashboard (`/sessions`)

The dashboard exposes:
1. `listHostedSessions()`: Enumerates all `deci.live.host.*` entries, returns `{ projectRef, title, credentials, isLive, connectedCount, isRevoked }`.
2. `listJoinedSessions()`: Reads all records from IndexedDB `live_sessions`, returns `{ sessionId, title, cachedAt, lastSyncedAt, role, name }`.
3. `revokeSession(projectKey)`: Triggers the revocation procedure above.
4. `purgeJoinedSession(sessionId)`: Deletes the cached record from IndexedDB.

---

## 7. Dynamic Role Control & Participant Vote Dropping

### 7.1 Dynamic Role Toggle (`setRole`)

1. **Host State Transition**:
   - `LiveShareHost` manages a mutable `role: LiveRole` (initial value `"contribute"` or `"view"` per config).
   - The host exposes `setRole(role: LiveRole): void`.
   - When `setRole` is invoked:
     1. Internal state updates: `this.role = role`.
     2. Host triggers a snapshot broadcast to all connected guests over WebRTC data channels, including the new role in the frame:
        ```json
        {
          "t": "snapshot",
          "rev": 14,
          "snapshot": { ... },
          "role": "view"
        }
        ```
     3. Incoming guest submission messages received while `this.role === "view"` are rejected immediately with:
        ```json
        {
          "t": "error",
          "code": "read_only",
          "message": "The host made this session view-only."
        }
        ```
2. **Guest Reaction**:
   - In `LiveShareGuest`, the `onMessage` handler for `snapshot` messages updates the guest's cached role:
     ```ts
     if (msg.role) {
       this.state.role = msg.role;
       this.emitChange();
     }
     ```
   - In `GuestSession.tsx`:
     - `canContribute = live && state.role === "contribute"`.
     - When `state.role === "view"`, all input elements (rating sliders, star widgets, comment inputs, ballot rankings) are disabled.
     - A banner is displayed: *"The host made this session view-only."*
     - If the host switches back to `setRole("contribute")`, inputs are immediately re-enabled.

### 7.2 Interactive Participant Roster

1. **Profile Derivation**:
   - The host computes `LiveParticipantProfile[]` by mapping over all known participants in the session:
     ```ts
     const roster: LiveParticipantProfile[] = participants.map((p) => {
       const isConnected = guestPeers.some((g) => g.participantId === p.id);
       const gradesCount = countGradesForParticipant(project, p.id);
       const hasBallot = checkBallotForParticipant(project, p.id);
       return {
         participantId: p.id,
         name: p.name,
         isHost: p.id === hostParticipantId,
         online: isConnected,
         gradeCount: gradesCount,
         hasBallot,
         role: hostRole,
       };
     });
     ```
2. **UI Presentation**:
   - Roster is rendered inside `LiveSessionDialog.tsx` under a **"Participants"** tab/section.
   - For each non-host participant, the row displays:
     - Name and online badge (Green = connected, Gray = offline).
     - Submissions summary: e.g. "3 grades submitted", "Ballot cast".
     - Action button / menu: **"Drop votes"**.

### 7.3 Participant Vote Dropping Protocol

1. **Execution**:
   - When the host clicks **"Drop votes"** for a specific participant:
     ```ts
     const resetEntry: ProjectEntry = {
       id: crypto.randomUUID(),
       timestamp: new Date().toISOString(),
       author: hostAuthor,
       kind: "reset",
       scope: "participant",
       participantId: targetParticipantId,
       targets: ["grades", "ballots"],
     };
     await store.append(projectRef.id, resetEntry);
     ```
2. **Tally Recalculation & Broadcast**:
   - Appending the reset entry updates the authoritative project store.
   - The host coalescer builds a fresh redacted snapshot reflecting the updated scores and rankings.
   - The snapshot is broadcast to all peers within 30 ms.
   - All connected peers and the host recalculate decision tallies in real-time, removing the dropped votes.
3. **Audit Trail Compliance**:
   - Per Constitution Principle VI, no entries are physically deleted or mutated in-place. The reset entry records that the host dropped the participant's votes at that timestamp, ensuring historical replayability and verification.

