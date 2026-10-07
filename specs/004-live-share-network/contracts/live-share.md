# Contract: Live Share (in-page session) — v2.1.0

Plugin ID: `org.decisionator.share.inpage` · package `@decisionator/share-inpage`

Supersedes [002 in-page share v1.0.0](../../002-local-storage-sharing/contracts/inpage-share.md).
v1 only ever worked between tabs of one browser (BroadcastChannel), recorded every guest vote as
the host, and could not tell a guest whether a vote was saved. v2 is not wire-compatible with v1;
v1 join links (`#/join/<sessionId>`) show an "incomplete link" page.

## Roles and topology

- **Host**: the owner's tab. Authoritative: it validates every guest submission and records it
  in the project's own store (any `ProjectStore`) through delegated append
  ([project-store v1.2.0](../../001-decision-engine-core/contracts/project-store.md)).
- **Guests**: connect to the host only (star). Guests never talk to each other.

## Join link

```
<app base>#/join/<sessionId>/<secret>
```

- `sessionId`: 72-bit random, base64url. `secret`: 128-bit random, base64url.
- Both live in the URL fragment, so they never reach a web server.
- A project keeps the same credentials on the host's device (`localStorage`), so a printed QR
  code keeps working and returning guests keep their identity.
- On a loopback origin (`localhost`, `127.0.0.1`, `*.localhost`) the host is asked for an
  address other devices can reach; the link and QR code use it.

## Keys

```
okm        = HKDF-SHA256(ikm = sessionId ‖ 0x00 ‖ secret, salt = "deci-live/2", info = "signal+topic", 64)
signalKey  = okm[0..32]      # AES-256-GCM key for signaling envelopes
topic      = hex(okm[32..64])  # rendezvous topic; reveals neither sessionId nor secret
```

Implemented with `@noble/*` (pure JS) so guests on a plain-http LAN address, where
`crypto.subtle` is unavailable, can still join.

## Signaling (rendezvous)

Two messages per connection, both sealed as `base64url(nonce12 ‖ AES-GCM(signalKey, nonce, json, aad = topic))`:

```ts
{ v: 1, kind: "offer",  from: guestAttemptId,             nonce, ts, sdp }
{ v: 1, kind: "answer", from: hostId, to: guestAttemptId,  nonce, ts, sdp }
```

- Non-trickle ICE: each SDP carries the candidates gathered within 3 s.
- Receivers drop envelopes that fail to authenticate, duplicates (by `nonce`) and anything older
  than 60 s.
- The guest re-sends its offer every 3 s until answered; the host answers a repeated offer with
  the same answer.
- Transports (any combination, messages fan out and are de-duplicated):
  - **BroadcastChannel** `deci-live:<topic>`: tabs of the same browser profile, no network.
  - **Nostr** (NIP-01): ephemeral events of kind `25050`, tag `["t", topic]`, signed with a
    throwaway key, sent to every configured relay. Relays see only the topic and sealed blobs.
- Defaults: relays `relay.damus.io`, `nos.lol`, `relay.primal.net`, `nostr.mom`; ICE servers
  `stun.l.google.com:19302`, `stun.cloudflare.com:3478`. Users can replace both (Settings → Live
  session network, or `VITE_LIVE_RELAYS` / `VITE_LIVE_ICE_SERVERS` at build time), including a
  TURN server for networks that block direct connections. No relays = same-browser only.

## Link layer (RTCDataChannel `deci-live`, ordered)

Frames are strings:

| Frame | Meaning |
|-------|---------|
| `m<json>` | a whole message |
| `c<id>,<index>,<count>\|<part>` | one chunk of a message longer than 16 000 characters |
| `p` / `q` | ping / pong |

Either side pings every 5 s and closes the link after 15 s without hearing anything. Guests
accept messages up to 16 MiB; the host accepts guest messages up to 16 MiB reassembled.

## Session protocol (version 2)

Guest → host:

```ts
{ t: "hello",  proto: 2, key: string /* 64 hex */, name: string /* 1..80 */ }
{ t: "submit", id: string, entries: GuestEntry[] /* 1..50 */ }
{ t: "bye" }

type GuestEntry =
  | { kind: "grade";   optionId: string; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: "comment"; optionId: string; body: string /* 1..10000 */; replaces?: string }
  | { kind: "ranking"; ranking: string[] /* unique */; round: number };
```

Host → guest:

```ts
{ t: "welcome",  proto: 2, participantId, name, role: "contribute" | "view", rev, snapshot }
{ t: "snapshot", rev, snapshot }            // ignored unless rev increases
{ t: "ack", id, ok: true }
{ t: "ack", id, ok: false, code: "invalid" | "read_only" | "voting_closed" | "rate_limited" | "store_failed", message }
{ t: "closing", reason }                    // host ended the session
{ t: "error", code: "protocol_mismatch" | "session_full" | "bad_hello", message }  // then the link closes
```

### Identity

```
key           = hex(SHA-256("deci-live/participant" ‖ 0 ‖ deviceSecret ‖ 0 ‖ sessionId))   # computed by the guest
participantId = "peer:" + hex(SHA-256("deci-live/pid" ‖ 0 ‖ key))[0..24]                   # computed by the host
```

`deviceSecret` is 256-bit random in the guest's `localStorage`. Rejoining (reload, reconnect)
yields the same `participantId`, so a guest has one vote; other guests cannot produce it because
`key` never leaves the guest–host link. Different sessions see unrelated ids.

### Host rules

1. A link must say `hello` within 10 s. At most 64 links per session.
2. Submissions are validated **inside the host's write queue**, one at a time, against the state
   left by every earlier write:
   - view-only session → `read_only`;
   - grades and comments only on `active` options;
   - `replaces` only for the guest's own comment on the same option;
   - rankings only while voting is `open`, for the current round, unique, ≤ `topN`, active
     options only.
3. Accepted entries are written with `append(ref, entries, { onBehalfOf: { participantId, displayName } })`.
   The guest gets `ack ok` only after the store call resolved; a failure is reported as
   `store_failed` with the store's message.
4. Rate limit: token bucket per link, 20 burst, 5/s.
5. After any change (a guest write or the store's `watch`), the host sends every guest a fresh
   snapshot (coalesced within 30 ms), redacted per guest:
   - `role` is the session role, never `owner`;
   - `contributions` removed; removed options dropped; hidden comments' bodies emptied;
   - `project.kdf` and `project.ref` removed;
   - while voting is open and `liveResults` is off, only the guest's own rankings.
6. Display names are unique among connected participants: on `hello` the host compares the
   trimmed name case-insensitively with the other participants that have open links and, on a
   clash, appends the lowest free number (`"Gina"` → `"Gina 2"`). The result is sent as
   `welcome.name`, used as `displayName` for that guest's entries and kept for the
   `participantId` for the rest of the session, so a reconnect keeps `"Gina 2"`.
7. Ending the session sends `closing` to every guest. Closing or reloading the host tab ends the
   session (best effort `closing` on `pagehide`; guests detect the dropped link otherwise).

### Guest rules

- States: `connecting` → `live` ⇄ `reconnecting` → `ended` | `failed`.
- On a dropped link, every unacknowledged submission is rejected (`offline`) and the guest
  reconnects with exponential backoff (1 s … 10 s) for up to 2 minutes, then `failed` (manual
  retry available).
- Submissions are refused while not `live`; each waits up to 10 s for its `ack`.
- After `ended`, the last snapshot stays visible and can be exported.
- The guest shows itself under `welcome.name`, which may differ from the name it sent.

## Hosting lifecycle (web app)

The hosting session belongs to the app (`LiveShareProvider`), not to a page or dialog: the host
can navigate between project pages and close the panel while guests keep voting. A header
indicator shows the session and the number of people connected. One session per tab; starting
another asks to end the first. A protected project must be unlocked in the tab before hosting.

## Test kit

- `plugins/share-inpage/test/host-guest.test.ts`: host and guests over in-memory links —
  attribution, identity stability, unique display names, serialized concurrent writes,
  validation (including grades and comments while voting is closed), view-only, store failure,
  redaction, roster, session full, closing, reconnect, give-up, protocol mismatch, rate limit.
- `plugins/share-inpage/test/transport.test.ts`: sealing, topic derivation, framing and chunking,
  heartbeat timeout, signaling room authentication/dedupe/staleness, Nostr event signing,
  subscribe/publish/queue/reconnect.
- `apps/web/e2e/live-session.spec.ts`: two pages over real WebRTC data channels.

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 2.1.0 | 2026-10-07 | Host assigns unique display names (`"Gina 2"`) and returns them in `welcome.name`; the guest shows that name. Wire `proto` stays 2: no message shape changes |
| 2.0.0 | 2026-10-06 | Network transport (WebRTC star + encrypted Nostr/BroadcastChannel signaling), per-guest attribution through delegated append, acks, heartbeat and reconnect, host-side validation and redaction, app-level session lifecycle, stable join links with QR code |
| 1.0.0 | 2026-10-06 | BroadcastChannel-only prototype (002) |
