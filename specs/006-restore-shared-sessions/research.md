# Research: Restore Shared Sessions Across Devices and Disconnects

**Feature**: `006-restore-shared-sessions` | **Date**: 2026-10-11

Data shapes referenced here are defined once in [data-model.md](./data-model.md).

## Findings & Architectural Decisions

### R1 — Host Recognition & Bi-directional Index

- **Problem**: When a project owner clicks a join link they previously shared, the app routes to `JoinLivePage` and treats them as a guest. The host tab then tries to connect to itself and ends with "Could not reach the host".
- **Decision**: Keep a reverse index `deci.live.bySession.<sessionId>` → `${store}:${id}` (data-model §3), written whenever `hostCredentialsFor(projectKey)` runs. `JoinLivePage` checks the revocation flag first, then the index. On a match it offers **Resume Live Session** / **Open Project**.
- **Alternatives considered**:
  - *Scan all projects on mount*: slow, and it needs storage APIs before render.
  - *Embed a host token in the link*: leaks host status to everyone holding the link.

---

### R2 — Host Reload Resilience

- **Problem**: Hosting lives in React state, so F5 drops every data channel.
- **Decision**: Store `ActiveHostingDescriptor` (data-model §4) in `sessionStorage` and auto-`start()` on mount if the heartbeat is under 1 hour old. This covers **reloads only**; `sessionStorage` is dropped when the tab closes, and after that R1 applies (FR-002).
- **Alternatives considered**:
  - *Service Worker hosting*: Service Workers cannot hold WebRTC data channels.
  - *`localStorage`*: risks orphaned background hosting days later.

---

### R3 — Guest Local Snapshot Cache

- **Problem**: A returning guest sees a 120 s spinner and then a failure, although they received the full snapshot earlier.
- **Decision**: Add a `live_sessions` IndexedDB store holding `CachedLiveSessionRecord` (data-model §5). Render from it immediately, dial in parallel, and write every live or verified relay snapshot back. Evict least-recently-opened records, keeping 30.
- **Credentials in cache**: the record keeps the join-link `secret`, which the guest already holds. It is needed to reconnect and is deleted with the record. Host credentials never reach guests (FR-009).
- **Alternatives considered**: *localStorage* hits its ~5 MB limit quickly.

---

### R4 — Asynchronous Relay Snapshots (NIP-78) with Host Authenticity

- **Problem 1**: A first-time guest has no cache and no host to talk to.
- **Problem 2 (found in analysis)**: `signalKey` and `topic` derive from the link, so every guest can produce them. If the relay signing key were also derived from the link, any guest could sign a replacement snapshot or a fake tombstone.
- **Decision**:
  - The host keeps a separate `relaySecret` (data-model §1) that never leaves its browser and derives a Schnorr key pair from it.
  - The public key `hostKey` goes into the link as an optional segment `#/join/:sessionId/:secret/:hostKey` and into `welcome` snapshots.
  - Records are `kind 30078` with `d = topic`, signed by the host key, and sealed with `signalKey` for confidentiality.
  - Guests subscribe with `authors: [hostKey]` and verify the signature. Since relays replace by `(pubkey, kind, d)`, nobody else can overwrite the host's record.
  - **Older links** (no `hostKey`): guests pin the key from the first live `welcome` (trust on first use) and ignore relay records until then.
- **Alternatives considered**:
  - *Key derived from the link secret*: forgeable by any guest (rejected for security).
  - *MAC inside the sealed payload*: any guest holding `signalKey` can produce it too.
  - *Central HTTP/KV store*: breaks the serverless architecture.

---

### R5 — "Restore to Workspace"

- **Decision**: A **Save to my workspace** action uses `snapshotToExport` + `restoreProject` with a destination chooser, then navigates to the new project. Attribution is preserved by `copyEntriesAsAuthors`.
- **Alternatives considered**: *Automatic background saving* creates projects the guest never asked for.

---

### R6 — Protocol & Contract Compatibility

- Live-share contract **3.0.0 → 3.1.0**, still `proto: 3`, all additive:
  - `snapshot.role?` (optional)
  - `closing.code?` (optional; free-text `reason` kept)
  - optional `/:hostKey` link segment
  - new relay kind
- `FatalErrorCodeSchema` is **not** extended. A new fatal code would fail parsing on 3.0.0 guests, which counts as a breaking change under Principle II.
- `read_only` stays an `Ack` code, as in 3.0.0. It is not a fatal error.
- Agentic API **1.1.0 → 1.2.0** (additive, R9).
- `ProjectStore` 1.4.0 and `restoreProject` are unchanged.

---

### R7 — Central Session Control, Revocation & Relay Retraction

- **Problem**: Host credentials can't be listed, revoked, or purged. Guests can't clean up their caches.
- **Decision**:
  1. A `/sessions` dashboard lists hosted sessions (from `deci.live.host.*`) and joined sessions (from `live_sessions`). The connected peer count is shown only for a session hosted in **this** tab; other sessions show Idle and their last active time.
  2. **Revoke**:
     - `host.revoke()` sends `{ t:"closing", code:"session_revoked", reason:"This session link has been revoked by the owner." }`. A 3.0.0 guest shows the reason as an ended session; a 3.1.0 guest enters `revoked`.
     - Credentials rotate (new `sessionId`, `secret`, and `relaySecret`), the revocation flag is set, and the reverse index entry is removed.
  3. **Retraction**: publish a host-signed `tombstone` payload with the same `d` tag, which replaces the snapshot. Also send a best-effort NIP-09 deletion.
  4. **Limits**: a guest on another device with no relay and no host reachable cannot learn about the revocation. It receives no new data, though. SC-005 is worded accordingly.

---

### R8 — Live Participant Roster, Drop Votes & Read-Only Toggle

- **Problem**: The host sees passive peer badges only. It can't drop one person's votes from the live panel or freeze input without ending the session.
- **Code facts verified**:
  - `LiveRole = "contribute" | "view"` exists.
  - `host.ts` holds `private readonly role`.
  - `policy.checkSubmission` already returns `code: "read_only"`, sent as an `Ack`.
  - The `SnapshotUpdate` schema has **no** `role` field.
  - `guest.ts` sets `role` only on `welcome`.
  - `ResetDialog` writes participant resets as **two** entries: grades, plus ballots with `round`.
- **Decision**:
  1. **Roster**: a pure `buildRoster()` function (data-model §8) that combines live guests with entry authors and counts effective grades and ballots after resets.
  2. **Drop votes**:
     - Extract `participantVoteResets(participantId, round)` from `ResetDialog` into `features/history/reset-entries.ts`, and append it through the host's normal project write path behind a confirmation dialog.
     - The affected guest gets a toast, "The host reset your votes.", based on its own grades and ballot clearing together with a matching reset entry.
     - Append-only (Principle VI).
  3. **Read-only**:
     - Make `role` mutable and add `setRole()`, which re-broadcasts the snapshot with `role`.
     - Add `role` to the `SnapshotUpdate` schema as an optional field; `guest.ts` applies it on every snapshot.
     - Rejection keeps using `Ack { ok:false, code:"read_only" }`, with the message changed to "The host made this session view-only."
- **Alternatives considered**:
  - *Kick instead of drop*: the votes would stay in the tally.
  - *UI-only lock*: outdated clients could still submit, so the host must enforce it.
  - *A new fatal error frame for read-only*: it would end the guest's session.

---

### R9 — Agent Access to Session Moderation (Principle IV)

- **Problem**: The admin actions must also be reachable through the agentic API. But Principle IV forbids agents from silently changing outcomes, and dropping votes changes the outcome.
- **Decision**:
  - Agentic API 1.2.0 adds `get_live_session` (read the roster and status, with pseudonymous ids) and `propose_moderation` (a new opt-in `moderate_session` permission). Proposals wait in the live panel for **Accept** / **Dismiss**, and all three steps are audited.
  - The host tab pushes the live summary to the local node over the existing agent bridge.
- **Staged Compliance**: US6 (P3) ships after US5. Until then, moderation has no API, and this is recorded as deferral **D1** in plan.md, with the interim measure that reset entries are visible to agents through `get_context` history. The deferral is disclosed in the changeset and release notes.
