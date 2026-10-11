# Implementation Plan: Restore Shared Sessions Across Devices and Disconnects

**Branch**: `006-restore-shared-sessions` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-restore-shared-sessions/spec.md`

## Summary

Enable seamless restoration and complete lifecycle control of shared live sessions across devices, host disconnects, and offline periods. Build a 6-tier architecture:
1. **Host Bi-directional Index & Reload Recovery**: Local mapping of `sessionId` to `projectKey` allows the host to reopen their own shared link and immediately resume hosting; `sessionStorage` persistence recovers active hosting across browser tab reloads (F5) so guests reconnect without disruption.
2. **Guest Local Snapshot Cache**: Cache deliberations in IndexedDB (`live_sessions`) so returning guests can immediately view decisions, options, comments, and outcomes even when the host is offline, with LRU eviction (retaining 30 sessions).
3. **Asynchronous Relay Snapshots with Host Authenticity**: Use Nostr NIP-78 parameterized replaceable events (`kind 30078`) signed by a host-only Schnorr key (`hostKey` in link) to store AES-256-GCM sealed snapshots on public relays, preventing link holders from forging or replacing snapshots.
4. **Workspace Project Ingestion**: A "Save to my workspace" action forks the shared deliberation into an independent permanent project in the user's chosen storage backend, preserving all author attributions, ratings, rankings, and history.
5. **Central Session Control, Revocation & Live Moderation**: A central Sessions Dashboard (`/sessions`) and interactive live session panel for owners to monitor all shared decisions, inspect participant rosters, drop errant votes from specific participants via append-only resets, toggle live sessions between contribution and read-only modes, revoke access links via `closing` frames with `code: "session_revoked"`, and purge published snapshots from public relays via tombstone events.
6. **Agentic Moderation API (US6, Staged Compliance)**: Expose live session state and moderation proposals to the owner's AI agent through `get_live_session` and `propose_moderation` (agentic API v1.2.0), requiring explicit owner acceptance.

Design artifacts: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/session-restore.md](./contracts/session-restore.md), [quickstart.md](./quickstart.md).

---

## Technical Context

**Language/Version**: TypeScript 5.7 (strict, ESM), Node.js 24 for tooling

**Primary Dependencies**:
- `@decisionator/core`: Zod models, crypto helpers (`@noble/ciphers`, `@noble/hashes`).
- `@decisionator/plugin-sdk`: `ProjectStore`, `ProjectSnapshot`, `restoreProject`.
- `@decisionator/share-inpage`: WebRTC star transport, Nostr client, framing, AES-GCM sealing.
- `@decisionator/node`: Local agent API host (MCP and REST endpoints).
- `idb`: IndexedDB wrapper for `DecisionatorDB`.
- `react` 19, `react-router-dom` 7, Radix UI, `lucide-react`.

No new runtime dependencies added.

**Storage**:
- `localStorage`: Reverse index `deci.live.bySession.<sessionId>` $\rightarrow$ `${store}:${id}`, revocation flags `deci.live.revoked.<sessionId>`, host credentials with `relaySecret`.
- `sessionStorage`: In-flight active hosting descriptor `deci.live.activeHosting`.
- `IndexedDB`: Object store `live_sessions` in `decisionator-store`.
- Relays: Opaque sealed snapshots on public Nostr relays (NIP-78 `kind 30078`) signed by `hostKey`, plus tombstone retractions.

**Testing**:
- Vitest: Unit and contract tests for NIP-78 snapshot transport with host verification, reverse index, cache store, revocation closing, dynamic role toggle, vote dropping, agent API moderation, and restoration pipeline.
- Playwright: Multi-browser E2E testing host reload resilience, guest offline view, link revocation, participant vote dropping, read-only mode, and workspace forking.

**Target Platform**: Modern desktop and mobile browsers (Chrome, Firefox, Safari); `@decisionator/node` for the agent API.

**Performance Goals**:
- SC-001: Returning participants view options and outcomes in under 1 s via local cache.
- SC-002: Host tab reload re-establishes guest connections in under 5 s.
- SC-004: First-time guests fetch asynchronous snapshot from relays in under 5 s.
- SC-005: When an owner revokes a link, connected guests see revocation within 1 s, and later attempts receive no session data.
- SC-006: Host toggling read-only mode locks 100% of guest controls within 1 s.
- SC-007: Dropped votes update all connected peer tallies within 1 s.

---

## Constitution Check

*GATE: Passed before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Evaluation | Status |
|---|---|:---:|
| **I. Minimal core, modules** | All network/signaling logic is encapsulated in `@decisionator/share-inpage`. Local caching and UI workflows belong to `@decisionator/web`. Agent operations in `@decisionator/node`. Core domain models remain untouched. | PASS |
| **II. Versioned contracts** | Wire protocol stays `proto: 3` (additive changes only: optional `snapshot.role`, optional `closing.code`, optional `/:hostKey`). New contract `contracts/session-restore.md` v3.1.0 and `agentic-api.md` v1.2.0. Storage uses existing `ProjectStore` 1.4.0. | PASS |
| **III. Simple by default** | Single link format (`#/join/:sessionId/:secret[/:hostKey]`) handles live joining, host re-entry, and offline viewing transparently. Central session management lives behind `/sessions`. | PASS |
| **IV. Agent-native** | Moderation and roster access exposed via `get_live_session` and `propose_moderation` in US6. **Deferred under Staged Compliance (D1)** for phases prior to US6; interim measure: agents observe reset entries via `get_context`. Agents only propose; owners accept/dismiss. | PASS |
| **V. User owns the data** | Full control: owners can revoke links, purge relay snapshots with tombstones, drop errant votes, and toggle read-only mode at any time. Relay snapshots signed by host-only key, encrypted with HKDF keys. Zero metadata leakage. | PASS |
| **VI. Reproducible, append-only** | Forking sessions into workspace projects preserves full append-only entry logs, timestamps, and author attributions via `copyEntriesAsAuthors`. Vote dropping appends two reset entries (grades + ballots with round) without mutating history. | PASS |
| **VII. Test-first for contracts** | Contract tests for NIP-78 sealed snapshot transport, revocation closing, role toggling, participant resets, and agent API operations written before UI implementation. | PASS |
| **Dependencies** | No new dependencies added (`idb` and `@noble/*` already in workspace). | PASS |
| **Accessibility** | All new dialogs, banners, and status indicators meet WCAG 2.1 AA with axe validation. | PASS |

---

## Project Structure

### Documentation (this feature)

```text
specs/006-restore-shared-sessions/
├── plan.md              # Implementation plan (this file)
├── spec.md              # Feature specification
├── research.md          # Technical research & decisions (Phase 0)
├── data-model.md        # Entities, schemas, & state machines (Phase 1)
├── quickstart.md        # Validation scenarios & testing guide (Phase 1)
├── contracts/
│   └── session-restore.md # Asynchronous relay transport, cache contract & agent API (Phase 1)
├── checklists/
│   └── requirements.md  # Quality validation checklist
└── tasks.md             # Implementation tasks (/speckit-tasks command)
```

### Source Code Architecture

```text
plugins/share-inpage/src/
├── nostr.ts            # NIP-78 kind 30078 replaceable event publish, subscribe & tombstones with hostKey signing/verification
├── signaling.ts        # SignalingRoom support for replaceable snapshot events
├── host.ts             # Host broadcast triggers NIP-78 sealed snapshot publish, setRole(role), rejection in read-only mode, revocation closing
├── guest.ts            # Guest bootstrap from NIP-78 snapshot, dynamic role adoption on snapshot, revocation handling, reset notice
├── protocol.ts         # Additive schemas: snapshot.role, closing.code
└── session.ts          # Wire options & network configuration

apps/web/src/
├── features/live/
│   ├── live-config.ts          # Reverse index: deci.live.bySession.<sessionId>, relaySecret generation, revocation registry
│   ├── LiveShareContext.tsx    # sessionStorage activeHosting reload auto-resume
│   ├── LiveSessionDialog.tsx   # Interactive participant roster, "Drop votes" action, "Read-only" toggle switch, moderation proposals
│   ├── GuestSession.tsx        # Cached snapshot render, "Restore to workspace" button, dynamic read-only banner & lock, reset toast, revocation state
│   ├── ForkSessionDialog.tsx   # Modal to choose target store for project restoration
│   ├── SessionsDashboard.tsx   # Central /sessions dashboard (hosted & joined sessions)
│   ├── RevokeSessionDialog.tsx # Modal to confirm link revocation & relay snapshot purging
│   └── participant-roster.ts   # Pure buildRoster() helper combining live peers and entry authors
├── features/history/
│   └── reset-entries.ts        # Shared participantVoteResets(participantId, round) helper
└── sync/
    └── db.ts                   # IndexedDB live_sessions object store & LRU helpers

packages/node/src/agent-api/
├── mcp.ts                      # get_live_session and propose_moderation MCP tools
├── rest.ts                     # GET /live-session and POST /live-session/proposals endpoints
└── state.ts                    # Live session summary push and pending moderation proposals
```

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **D1** (Staged Compliance): Agent moderation parity deferred to US6 (Principle IV) | Owner UI for live deliberation moderation (P1) is needed immediately to unblock collaborative sessions. Full MCP/REST exposure requires bridging active browser hosting state to `packages/node`. | Leaving moderation out of the agentic API permanently would violate Principle IV. Deferring to US6 allows delivering human moderation first while guaranteeing agent API parity in the same feature. Interim measure: agent reads resets via `get_context` history. |
