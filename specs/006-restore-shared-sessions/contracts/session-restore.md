# Contract: Session Restoration, Asynchronous Snapshots & Session Moderation — v3.1.0

Package: `@decisionator/share-inpage` & `@decisionator/web` (agent operations: `@decisionator/node`)

Extends [Live Share Contract v3.0.0](../../004-live-share-network/contracts/live-share.md) to **v3.1.0**.
The wire protocol stays `proto: 3`. Every wire change below is **additive**: a new optional
field or an optional link segment. Guests on 3.0.0 strip unknown keys (zod default) and keep
working, as described per change. Data shapes are defined in [data-model.md](../data-model.md).

---

## 0. Wire changes summary (v3.0.0 → v3.1.0)

| Change | Schema | Behaviour on a 3.0.0 guest |
|---|---|---|
| `snapshot.role?: LiveRole` | `SnapshotUpdate` gains `role: LiveRoleSchema.optional()` | Field stripped. Inputs stay enabled, but the host refuses submissions with `ack { ok:false, code:"read_only" }`, which 3.0.0 already shows. |
| `closing.code?: "session_revoked" \| "ended"` | `Closing` gains `code: z.enum([...]).optional()` | Field stripped. The guest shows `ended` with `reason` text "This session link has been revoked by the owner." |
| Link segment `/:hostKey` | Route `/join/:sessionId/:secret/:hostKey?` | Not applicable (same deployment); links without the segment still work. |
| NIP-78 relay records | New Nostr kind `30078` alongside the existing ephemeral signaling kind | Ignored. |

No new fatal (`t:"error"`) codes are added. `FatalErrorCodeSchema` is unchanged.

---

## 1. Asynchronous Snapshots: Host-Signed NIP-78 Records

### 1.1 Keys

- `signalKey`, `topic` = `deriveSessionKeys({ sessionId, secret })`, unchanged. These provide confidentiality only, since every link holder has them.
- `hostKeyPair` is derived from the host-only `relaySecret` (data-model §1). It provides **authenticity**: only the host can sign.
- `hostKey` (the x-only public key) travels in the link (`/:hostKey`) and in `welcome` snapshots under `snapshot.live.hostKey`.

### 1.2 Host publishing rule

1. After each coalesced broadcast (≤ 1 per 2 s to respect relay rate limits; the latest state wins), the host builds `RelayPayload { type:"snapshot", rev, publishedAt, snapshot }`. The snapshot uses the **most restrictive** guest redaction: no per-guest data, other participants' ballots hidden unless results are public.
2. It seals the payload: `content = seal(signalKey, topic, JSON(payload))`.
3. It signs a `kind: 30078` event with `hostKeyPair`, tags `[["d", topic], ["t", topic]]`, and publishes it to all configured relays.

### 1.3 Guest retrieval rule

1. On join, the guest determines `hostKey` from the link segment, else from the cached record (data-model §5). With no `hostKey`, it skips relay retrieval and waits for a live `welcome`, then pins `snapshot.live.hostKey` (TOFU).
2. It subscribes: `["REQ", subId, { "kinds": [30078], "authors": [hostKey], "#d": [topic], "limit": 1 }]`.
3. For each event it MUST verify `event.pubkey === hostKey` and the Schnorr signature, then unseal. It drops anything that fails (FR-017).
4. If `type === "snapshot"` and `rev > currentRev`, it renders the snapshot as "Host offline • from relay". If `type === "tombstone"`, it enters `revoked` and deletes the local cache.
5. A live `welcome`/`snapshot` always takes precedence over relay data with an equal or lower `rev`.

---

## 2. Host Reverse Resolution & Auto-Resume

### 2.1 Route interception (`/join/:sessionId/:secret/:hostKey?`)

1. If `deci.live.revoked.<sessionId>` exists, show the revocation notice.
2. If `deci.live.bySession.<sessionId>` resolves to an existing project, the user is the **host** and sees **Resume Live Session** / **Open Project**.
3. Otherwise, run the guest flow (§3, §1.3).

### 2.2 Reload resilience

`LiveShareProvider` writes `ActiveHostingDescriptor` (data-model §4) to `sessionStorage` on start and refreshes `lastHeartbeat` every 30 s. On mount, if a descriptor with `lastHeartbeat` < 1 h old exists, it calls `start()` for that project. It clears the descriptor on **End session** and on revocation. Guests reconnect through their existing backoff.

---

## 3. Guest Local Offline Cache

1. On `JoinLivePage` load, read `live_sessions.get(sessionId)` (`CachedLiveSessionRecord`, data-model §5). Update `lastOpenedAt`.
2. If found, render immediately with "Host offline • Last synced [time]". Submissions are disabled with "Not connected to host".
3. In the background, `LiveShareGuest.start()` dials. Every `welcome`/`snapshot` and every verified relay snapshot is written back, then the LRU eviction (keep 30) runs.
4. If no cache, no verified relay record, and no host answer within the connect timeout, show "This session can't be reached right now. The host may be offline, or the link may be wrong or revoked." with **Retry**. A malformed link (bad id or secret length) shows "This link is incomplete or damaged." straight away.
5. A submission in flight when the link drops is reported as "Host disconnected; submission not saved" and kept in the input for retry.

---

## 4. "Restore to Workspace"

1. `bundle = snapshotToExport(snapshot)`.
2. Resolve the user-selected `ProjectStore`.
3. `restoreProject(targetStore, bundle)` re-creates the project and re-appends entries with original attribution (`copyEntriesAsAuthors`).
4. Navigate to `/p/:targetStore/:newId`.

---

## 5. Security & Privacy Guarantees (Principle V)

1. Relays see the opaque `topic`, the host's public key, and ciphertext. They never see `sessionId`, `secret`, titles, or identities.
2. `relaySecret` never leaves the host browser and never appears in links, snapshots, caches, or exports.
3. Relay snapshots are redacted at least as strictly as the least-privileged live guest.
4. Forged or replayed relay records are rejected by key pinning and signature check (§1.3).

---

## 6. Revocation & Relay Retraction

### 6.1 Procedure (`revokeSession(projectKey, { purgeRelays })`)

1. **Connected guests**: `host.revoke()` sends `{ "t":"closing", "code":"session_revoked", "reason":"This session link has been revoked by the owner." }` to every link, then closes the transport.
2. **Relay retraction** (if `purgeRelays`): publish a `kind: 30078` event signed by the **old** `hostKeyPair` with the same `d` tag and payload `{ v:1, type:"tombstone", publishedAt, reason:"revoked" }`. Because the event has the same `(pubkey, kind, d)`, it replaces the snapshot. Its `created_at` is strictly greater than that of the last snapshot this tab published, so relays cannot keep the snapshot on a same-second tie. Additionally send a NIP-09 `kind: 5` deletion for the last snapshot event id when it is known (best effort). The same procedure is used for a session that is not live in this tab (`publishTombstone`). `revoke` is asynchronous: it waits up to 5 s for relay `OK` acknowledgements before closing the room, so sockets still connecting do not lose the tombstone.
3. **Local**: set `deci.live.revoked.<oldSessionId>`, remove `deci.live.bySession.<oldSessionId>`, clear `deci.live.activeHosting`, and write a fresh `HostSessionRecord` (new `sessionId`, `secret`, and `relaySecret`).
4. **Guests**: a guest receiving `closing.code === "session_revoked"` or a verified tombstone enters `revoked`, shows the notice, and deletes its `live_sessions` record.

### 6.2 Sessions Dashboard (`/sessions`)

| Operation | Returns / effect |
|---|---|
| `listHostedSessions()` | `{ projectRef, title, link, createdAt, lastActiveAt, isLiveHere, connectedCount?, isRevoked }`. `connectedCount` is present only when `isLiveHere`. |
| `listJoinedSessions()` | Projection of `CachedLiveSessionRecord`: `{ sessionId, projectTitle, name, role, cachedAt, lastSyncedAt }`. |
| `revokeSession(projectKey, opts)` | §6.1 |
| `purgeJoinedSession(sessionId)` | Deletes the IndexedDB record, secret included. |

---

## 7. Dynamic Role Control, Roster & Vote Dropping

### 7.1 `LiveShareHost.setRole(role: LiveRole)`

1. `role` becomes mutable (`private role: LiveRole`).
2. On change, the host re-broadcasts the current snapshot to every guest with the new field: `{ "t":"snapshot", "rev": <current>, "snapshot": {...}, "role": "view" }`.
3. Submissions are checked with `checkSubmission(current, participantId, this.role, entries)` as today. When the role is `"view"`, the host replies `{ "t":"ack", "id": <submitId>, "ok": false, "code": "read_only", "message": "The host made this session view-only." }`. The message in `policy.ts` changes to that text.
4. `getRole()` is exposed for the UI.

### 7.2 Guest reaction

- On `snapshot` with `role` present: `set({ role: msg.role })`.
- `GuestSession`: `canContribute = live && state.role === "contribute"`. In view mode, inputs are disabled and the banner "The host made this session view-only." is shown. Switching back re-enables them.

### 7.3 Participant roster

`buildRoster(snapshot, guests, hostParticipantId): LiveParticipantProfile[]` is a pure function in `apps/web/src/features/live/participant-roster.ts`. It follows the source rules in data-model §8 and counts **effective** grades and ballots, meaning after earlier resets. The live panel shows name, online badge, "N grades", "Ballot cast", and a **Drop votes** button (with a confirmation dialog) for non-host rows.

### 7.4 Dropping votes

1. On confirm, the host appends `participantVoteResets(participantId, round)` (data-model §9) through its normal project write path, the same path as `ResetDialog`.
2. The project change triggers the usual coalesced broadcast (≤ 30 ms) to all peers.
3. **Guest notice**: after applying a snapshot, `LiveShareGuest` compares its own effective grade count and ballot with the previous snapshot. If they went from non-empty to empty with no pending own submission, and the snapshot holds a `reset` entry with `scope:"participant"` for its `participantId` newer than the last seen, the guest shows a toast: "The host reset your votes."
4. Nothing is deleted. History shows "Owner reset Tom's grades and ballot" (Principle VI).

---

## 8. Agentic API additions (agentic-api v1.1.0 → v1.2.0, US6)

Live-session data is only available while the owner's tab is hosting. The tab pushes a `LiveSessionSummary` to the local node over the existing agent bridge.

| MCP tool | REST | Permission | Description |
|---|---|---|---|
| `get_live_session` | `GET /live-session` | `read` on the whole project (agentic API 1.3.0) | `{ hosting, readOnly, revoked, participants: LiveParticipantProfile[] }`. `participantId` values are replaced by per-grant pseudonyms. Returns 404 `NOT_HOSTING` when no tab is hosting. |
| `propose_moderation` | `POST /live-session/proposals` | `moderate_session` (new, opt-in when granting) | `{ action, participant?, reason }`. Creates a pending `ModerationProposal` (data-model §10). Result: `{ id, status:"pending" }`. Never applies anything by itself. |

- The owner sees proposals in the live panel and chooses **Accept** or **Dismiss**. An accepted action runs exactly as if the owner had clicked it, and the resulting entries are authored by the owner with `proposedBy: <agent>` in the audit log.
- Audit events: `agent_moderation_proposed`, `agent_moderation_accepted`, `agent_moderation_dismissed`.
- Contract tests: tool/OpenAPI parity, the permission check (403 without `moderate_session`), pseudonymous ids, and the guarantee that nothing changes before acceptance.
