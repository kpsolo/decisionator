# Implementation Plan: Restore Shared Sessions Across Devices and Disconnects

**Branch**: `006-restore-shared-sessions` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-restore-shared-sessions/spec.md`

## Summary

Enable seamless restoration and complete lifecycle control of shared live sessions across devices, host disconnects, and offline periods. Build a 5-tier architecture:
1. **Host Bi-directional Index & Reload Recovery**: Local mapping of `sessionId` to `projectKey` allows the host to reopen their own shared link and immediately resume hosting; `sessionStorage` persistence recovers active hosting across browser tab reloads (F5) so guests reconnect without disruption.
2. **Guest Local Snapshot Cache**: Cache deliberations in IndexedDB (`live_sessions`) so returning guests can immediately view decisions, options, comments, and outcomes even when the host is offline.
3. **Asynchronous Relay Snapshots**: Use Nostr NIP-78 parameterized replaceable events (`kind 30078`) to store AES-256-GCM sealed snapshots on public relays, allowing first-time visitors to bootstrap the decision state even when the host tab is offline.
4. **Workspace Project Ingestion**: A "Save to my workspace" action forks the shared deliberation into an independent permanent project in the user's chosen storage backend, preserving all author attributions, ratings, rankings, and history.
5. **Central Session Control, Revocation & Admin Oversight**: A central Sessions Dashboard (`/sessions`) and interactive live session panel for owners to monitor all shared decisions, view connected and participating users with real-time submission counts, drop errant votes from specific participants via append-only resets, toggle live sessions between contribution and read-only modes, revoke access links (rotating credentials and ejecting peers), and purge published snapshots from public relays via tombstone events. Guests can view their deliberation history and purge local cached data.

Design artifacts: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/session-restore.md](./contracts/session-restore.md), [quickstart.md](./quickstart.md).

---

## Technical Context

**Language/Version**: TypeScript 5.7 (strict, ESM), Node.js 24 for tooling

**Primary Dependencies**:
- `@decisionator/core`: Zod models, crypto helpers (`@noble/ciphers`, `@noble/hashes`).
- `@decisionator/plugin-sdk`: `ProjectStore`, `ProjectSnapshot`, `restoreProject`.
- `@decisionator/share-inpage`: WebRTC star transport, Nostr client, framing, AES-GCM sealing.
- `idb`: IndexedDB wrapper for `DecisionatorDB`.
- `react` 19, `react-router-dom` 7, Radix UI, `lucide-react`.

No new runtime dependencies added.

**Storage**:
- `localStorage`: Reverse index `deci.live.bySession.<sessionId>` $\rightarrow$ `${store}:${id}`, revocation flags `deci.live.revoked.<sessionId>`.
- `sessionStorage`: In-flight active hosting descriptor `deci.live.activeHosting`.
- `IndexedDB`: Object store `live_sessions` in `decisionator-store`.
- Relays: Opaque sealed snapshots on public Nostr relays (NIP-78 `kind 30078`) and tombstone retractions.

**Testing**:
- Vitest: Unit and contract tests for NIP-78 snapshot transport, reverse index, cache store, revocation ejection, dynamic role toggle, vote dropping, and restoration pipeline.
- Playwright: Multi-browser E2E testing host reload resilience, guest offline view, link revocation, participant vote dropping, read-only mode, and workspace forking.

**Target Platform**: Modern desktop and mobile browsers (Chrome, Firefox, Safari).

**Performance Goals**:
- SC-001: Returning participants view options and outcomes in under 1 s via local cache.
- SC-002: Host tab reload re-establishes guest connections in under 5 s.
- SC-004: First-time guests fetch asynchronous snapshot from relays in under 5 s.
- SC-005: Revoked links refuse connection attempts within 1 s.
- SC-006: Host toggling read-only mode locks 100% of guest controls within 1 s.
- SC-007: Dropped votes update all connected peer tallies within 1 s.

---

## Constitution Check

*GATE: Passed before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Evaluation | Status |
|---|---|:---:|
| **I. Minimal core, modules** | All network/signaling logic is encapsulated in `@decisionator/share-inpage`. Local caching and UI workflows belong to `@decisionator/web`. Core domain models remain untouched. | PASS |
| **II. Versioned contracts** | Wire protocol stays `proto: 3` (additive signaling capability). New contract `contracts/session-restore.md` v3.1.0. Storage uses existing `ProjectStore` 1.4.0. | PASS |
| **III. Simple by default** | Single link format (`#/join/:sessionId/:secret`) handles live joining, host re-entry, and offline viewing transparently. Central session management lives behind `/sessions`. | PASS |
| **IV. Agent-native** | Projects restored into workspaces are standard Deci projects accessible by user agents via the public API. | PASS |
| **V. User owns the data** | Full control: owners can revoke links, purge relay snapshots with tombstones, drop errant votes, and toggle read-only mode at any time. Relays see only ciphertext blobs. Zero metadata leakage. | PASS |
| **VI. Reproducible, append-only** | Forking sessions into workspace projects preserves full append-only entry logs, timestamps, and author attributions via `copyEntriesAsAuthors`. Vote dropping uses append-only resets without deleting history. | PASS |
| **VII. Test-first for contracts** | Contract tests for NIP-78 sealed snapshot transport, revocation ejection, role toggling, and cache lifecycle written before UI implementation. | PASS |
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
│   └── session-restore.md # Asynchronous relay transport & cache contract (Phase 1)
├── checklists/
│   └── requirements.md  # Quality validation checklist
└── tasks.md             # Implementation tasks (/speckit-tasks command)
```

### Source Code Architecture

```text
plugins/share-inpage/src/
├── nostr.ts            # NIP-78 kind 30078 replaceable event publish, subscribe & tombstones
├── signaling.ts        # SignalingRoom support for replaceable snapshot events
├── host.ts             # Host broadcast triggers NIP-78 sealed snapshot publish, setRole(role), rejection in read-only mode, revocation ejection
├── guest.ts            # Guest bootstrap from NIP-78 snapshot, dynamic role adoption on snapshot, revocation error handling
└── session.ts          # Wire options & network configuration

apps/web/src/
├── features/live/
│   ├── live-config.ts          # Reverse index: deci.live.bySession.<sessionId>, revocation registry
│   ├── LiveShareContext.tsx    # sessionStorage activeHosting reload auto-resume
│   ├── LiveSessionDialog.tsx   # Interactive participant roster, "Drop votes" action, "Read-only" toggle switch
│   ├── GuestSession.tsx        # Cached snapshot render, "Restore to workspace" button, dynamic read-only banner & lock, revocation state
│   ├── ForkSessionDialog.tsx   # Modal to choose target store for project restoration
│   ├── SessionsDashboard.tsx   # Central /sessions dashboard (hosted & joined sessions)
│   └── RevokeSessionDialog.tsx # Modal to confirm link revocation & relay snapshot purging
└── sync/
    └── db.ts                   # IndexedDB live_sessions object store & helpers
```

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| None | All principles satisfied without deferrals. | N/A |
