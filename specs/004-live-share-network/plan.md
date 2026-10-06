# Implementation Plan: Live Sessions Across Devices

**Branch**: `004-live-share-network` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

## Summary

Rebuild `@decisionator/share-inpage` around a transport-agnostic host/guest core, a WebRTC
star topology with encrypted multi-relay signaling, and attribution through a new delegated
append in the `ProjectStore` contract. Move session ownership in the web app from a modal to an
app-level provider.

## Findings that drove the design

| # | Problem in 002 | Fix |
|---|----------------|-----|
| 1 | BroadcastChannel only: no cross-device, cross-browser or incognito guests | WebRTC data channels; BroadcastChannel kept only as a same-browser *signaling* path |
| 2 | Host appended guest entries as itself: guests overwrote the owner and each other; guests never saw their own grade | `ProjectStore.append(ref, entries, { onBehalfOf })` (contract v1.2.0) + `byName` on entries |
| 3 | Same bug in *Move project*: every collaborator's grades/ballots re-recorded as the mover and merged by latest-wins | Move re-appends each author's entries with `onBehalfOf` |
| 4 | Session lived in a blocking modal: closing it or changing page ended the session | `LiveShareProvider` above the router; non-blocking panel; header indicator |
| 5 | `localhost` join links, no QR code | Loopback detection with a reachable-address override; QR code (`uqr`) |
| 6 | Guest entries unvalidated: guests could append outcomes/contributions, vote while closed, spoof another guest's id | Host-side validation in the write queue; participant id derived from a secret only the guest holds |
| 7 | Concurrent appends raced (read-modify-write) and lost votes | Host write queue; file store serializes mutations per project |
| 8 | No acks, heartbeat or reconnect; peer count only grew | Acks with error codes, link heartbeat, guest reconnect with backoff, accurate roster |
| 9 | Snapshot leaked owner material (`role: "owner"`, agent drafts, hidden comment text, others' ballots with live results off) | Per-guest redaction |
| 10 | Large snapshots exceed the 16 KiB cross-browser data-channel message limit | Chunked framing |
| 11 | Protected local projects: comments stored in plaintext and then undecryptable; `watch` never fired | File store caches the unlocked key, encrypts comments, watch uses the key |

## Technical Context

- TypeScript strict ESM; zod 3; `@noble/ciphers`, `@noble/curves`, `@noble/hashes` (already in
  the workspace via `@decisionator/core`); `uqr` (MIT, zero dependencies) for QR codes.
- Browser APIs: `RTCPeerConnection`/`RTCDataChannel`, `WebSocket` (Nostr), `BroadcastChannel`.
- Tests: Vitest (in-memory links, fake sockets), Playwright (two pages, real WebRTC, Chromium).

## Architecture

```
plugins/share-inpage/src
  crypto.ts          session credentials, HKDF keys, AES-GCM seal, participant ids
  protocol.ts        zod schemas: signal envelope, guest entries, session messages (v2)
  link.ts            Link over a string pipe: framing, chunking, heartbeat; in-memory pipes
  signaling.ts       SignalingRoom (seal/unseal, fan-out, dedupe, staleness) + BroadcastChannel
  nostr.ts           minimal NIP-01 client (ephemeral kind 25050, reconnecting relays)
  rtc.ts             listenForGuests / dialHost: non-trickle WebRTC over a SignalingRoom
  policy.ts          checkSubmission, redactSnapshotFor
  hosted-project.ts  HostedProject port + adapter over ProjectStore (delegated append)
  host.ts            LiveShareHost: links, hello, write queue, acks, broadcast, roster
  guest.ts           LiveShareGuest: dial/reconnect state machine, submit with ack
  session.ts         startHosting / joinSession wiring + network defaults
apps/web/src/features/live
  LiveShareContext   app-level hosting session, beforeunload/pagehide handling
  LiveSessionDialog  link, QR, roster, loopback warning, Hide / End session
  LiveIndicator      header pill
  GuestSession       join page: grades, comments, ballot, results, reconnect/ended states
  LiveNetworkSettings, live-config (relays, ICE, stable host credentials, guest identity)
```

The host and guest cores have no transport dependency, so they are fully unit-tested over
in-memory links; WebRTC and Nostr are thin adapters.

### Alternatives considered

- **PeerJS cloud broker**: one public broker as a single point of failure, broker sees peer ids.
- **Trystero**: full mesh (every guest connects to every guest): 190 connections at 20 guests.
- **Manual SDP copy/paste or QR exchange**: needs two exchanges per guest; unusable in a room.
- **Self-hosted relay (`packages/relay`)**: not available to GitHub Pages users by default;
  remains possible later as another `SignalingTransport`.

## Constitution Check

| Principle | Evaluation | Status |
|-----------|------------|:------:|
| I. Minimal core, modules | All logic in the `share-inpage` plugin; it uses only the public `ProjectStore` contract (delegated append is a public contract feature, used also by Move). No core special case. | PASS |
| II. Versioned contracts | `ProjectStore` 1.1.0 → 1.2.0 (additive, optional parameter; contract kit extended). Live-share protocol 2.0.0 with explicit `proto` check and a plain-language mismatch message. Changesets included. | PASS |
| III. Simple by default | One click starts a session; defaults need no configuration; relays/TURN live in Settings. | PASS |
| IV. Agent-native | No new user capability beyond voting already exposed; guest entries are ordinary entries with attribution. | PASS |
| V. User owns the data | Starting a session is an explicit action. Project data flows only browser-to-browser (DTLS). Relays receive only AES-GCM-sealed SDP under an opaque topic; credentials stay in the URL fragment. Relays and STUN/TURN are user-configurable. Guests can export their view. | PASS |
| VI. Reproducible, append-only | Delegated entries obey the same append-only and latest-wins rules; outcomes cannot be delegated. | PASS |
| VII. Test-first for contracts | Contract-kit tests for delegated append written before store changes; protocol tests for host/guest. | PASS |
| Dependencies | `uqr` MIT, zero deps; `@noble/*` MIT, already used. | PASS |
| Accessibility | Dialog, guest page and settings card covered by axe in Playwright. | PASS |

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|------|-----|--------------------------------------|
| Own Nostr client (~200 lines) | Multi-relay redundancy, no SDK | `nostr-tools` adds weight for two message types |
| Chunked framing | Data channels cap messages at 16 KiB cross-browser | Real projects with comments exceed it |
| Public relays by default | Zero-setup cross-device rendezvous on a static host | Self-hosting a signaling server contradicts the "no server" goal |
