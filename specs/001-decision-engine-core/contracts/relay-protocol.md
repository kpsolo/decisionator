# Contract: Sync/Relay Protocol — v2.0.0

> **v2.0.0 (breaking):** signatures cover the query string and a mandatory nonce (replay cache);
> invites are bound to an out-of-band secret; `WS /v1/docs/{docId}/live` requires a signed
> subscribe from an ACL member; invite and tunnel ids are 128-bit random; rate limits (HTTP `429`).
> v1 clients are rejected with HTTP `401` / WS close `1008`.

> **Scope: post-MVP (US7, local-first mode).** The MVP shares projects through Google Drive ([sheet-store.md](./sheet-store.md)).

The relay is a self-hostable service (`packages/relay`, Docker image). It carries **encrypted**
shared-project changes and **agent tunnels**. It never holds project keys
([research R6, R8](../research.md)).

## Authentication

Every HTTP request and every WebSocket hello/subscribe is signed with the participant's Ed25519
key (`signRequest` / `verifyRequestSignature` in `@decisionator/core`).

```text
X-Dcg-Key:       <base64 Ed25519 public key>
X-Dcg-Timestamp: <unix ms>                       (±120 s skew allowed)
X-Dcg-Nonce:     <16–128 chars [A-Za-z0-9_-]>    (fresh 128-bit random value per request)
X-Dcg-Signature: <base64 sig over "METHOD\nPATH_AND_QUERY\nTIMESTAMP\nNONCE\nSHA256_HEX(body)">
```

- `PATH_AND_QUERY` is the request target as sent: the path plus `?query` when there is one
  (WHATWG-URL-normalised, as the relay sees it). Changing any query parameter breaks the signature.
- **Replay protection.** The relay remembers each verified `(key, nonce)` pair until its
  timestamp leaves the ±120 s window and rejects a repeat with `401` ("Replayed request nonce").
  Only verified requests enter the cache. The cache is in-memory and bounded; when it is full the
  relay answers `401` ("Replay cache full") rather than forgetting live entries.
- WebSocket messages use method `WS`, the socket's path as `PATH_AND_QUERY` and the canonical
  body given for each endpoint below; their `key`, `timestamp`, `nonce` and `signature` travel
  as JSON fields of the first message.

## Shared documents

| Endpoint | Who | Purpose |
|----------|-----|---------|
| `PUT /v1/docs/{docId}` | owner | Create the shared doc. Body: `{acl: SignedAcl}`. |
| `PUT /v1/docs/{docId}/acl` | owner | Replace the ACL. Body: `SignedAcl` with `version` greater than the current one. Removing a member takes effect immediately. |
| `POST /v1/docs/{docId}/changes` | owner, contribute | Append a `ChangeBatch` (below). The relay checks the signer's role in the current ACL and assigns `seq`. |
| `GET /v1/docs/{docId}/changes?after={seq}` | members | Pull batches after a cursor. Paginated. |
| `WS /v1/docs/{docId}/live` | members | Push notifications of new `seq` (contains no content). Authenticated by the first message (below). |
| `POST /v1/docs/{docId}/snapshots` | owner, contribute | An encrypted compacted snapshot. Lets new members skip the full log. |
| `DELETE /v1/docs/{docId}` | owner | Delete everything stored for the doc. |

```ts
type SignedAcl = {
  docId: string; version: number; keyEpoch: number;
  members: { key: string; encKey: string; role: "owner" | "contribute" | "view" }[];
  ownerSignature: string;                  // Ed25519 over canonical JSON of the fields above
};

type ChangeBatch = {
  keyEpoch: number;                        // which project key encrypted it
  nonce: string;                           // 24-byte XChaCha20 nonce, base64
  ciphertext: string;                      // XChaCha20-Poly1305(Automerge change bytes[]), base64
  signerKey: string;
  signature: string;                       // Ed25519 over (docId ‖ keyEpoch ‖ nonce ‖ ciphertext)
};
```

**Client-side checks.** Clients also verify the signature on every change and check the
signer's role against the ACL in effect. A batch from a non-writer is discarded even if the
relay accepted it. This protects against a compromised relay.

**Live notifications.** After the socket opens, the client must send, within 5 s
(`liveAuthTimeoutMs`), exactly one message:

```ts
{ type: "subscribe", key, timestamp, nonce, signature }
// signed: method "WS", target "/v1/docs/{docId}/live",
// body = UTF-8 of JSON.stringify({ type: "subscribe", docId })
```

The relay verifies it (including the replay cache) and checks that `key` is in the doc's current
ACL, then answers `{type: "subscribed", docId}` and sends `{type: "live", docId, seq}` per new
batch. Otherwise it sends `{type: "error", error}` and closes with code `1008`. It also closes
with `1008` on any further message, when the doc already has `maxLiveSubscribersPerDoc`
subscribers (default 100), and when the subscriber is no longer in the ACL at the time of a
notification.

## Invites (two-step, keys never in query strings, bound to an out-of-band secret)

1. The owner generates an invite secret (`generateInviteSecret()`, 256-bit, base64url) and
   calls `POST /v1/docs/{docId}/invites` with `{role, expiresAt, secretHash}`, where
   `secretHash = hashInviteSecret(secret)` (SHA-256 of the UTF-8 secret, lowercase hex). It gets
   back `inviteId` (`inv_` + 32 hex chars, 128-bit random). The owner then shares the link
   `decisionator://join?relay=<url>&invite=<inviteId>#secret=<secret>` (or its https equivalent
   on the relay). The secret stays in the URL fragment, so it is not sent in HTTP requests for
   the link and does not land in server logs.
2. The invitee's node calls `POST /v1/invites/{inviteId}/accept` with
   `{key, encKey, secret}`. `key` must be the request's signing key (`403` otherwise), and
   `SHA-256(secret)` must match the registered `secretHash` (constant-time compare, `403`
   otherwise). Invites created without a `secretHash` (relay v1) cannot be accepted. The relay
   queues the request for the owner. An invite can be accepted once: accepting an invite that is
   not `pending` returns HTTP `409` and leaves the stored keys unchanged.

   *Trust note:* the relay checks the secret, so a malicious relay operator could still
   substitute keys. Before sealing, the owner's UI SHOULD show the invitee's key fingerprint for
   out-of-band confirmation.
3. The owner's node, while online, confirms the invite. It adds the member to the ACL and posts
   `sealedKey = sealedBox(X25519(invitee), projectKey[epoch])` to
   `/v1/invites/{inviteId}/key`.
4. The invitee fetches the sealed key, decrypts it locally and pulls the changes.

**Revocation.** The owner publishes a new ACL without the member and with `keyEpoch + 1`. It
then distributes the new key, sealed to each remaining member. Later batches use the new epoch.

## Agent tunnel

| Endpoint | Purpose |
|----------|---------|
| `WS /v1/tunnels` | The node connects, with a signed hello `{type: "hello", key, timestamp, nonce, signature}` (method `WS`, target `/v1/tunnels`, body = UTF-8 of `{"type":"hello"}`), and receives a `tunnelId` (`tun_` + 32 hex chars, 128-bit random). The relay keeps it open. |
| `ANY /t/{tunnelId}/mcp`, `ANY /t/{tunnelId}/api/v1/*` | Public endpoints for remote agents. The relay forwards each HTTP request over the WS as a framed message and streams back the node's response. |

The relay does not inspect or store tunnel payloads, but the relay operator could see them in
transit. The UI states this when the user picks the "remote agent" channel (spec FR-071). The
node performs all grant checks. When the node is offline, the tunnel endpoints return
`503 NODE_OFFLINE` with a plain-language message.

## Limits (defaults, configurable by the operator)

| Limit | Default |
|-------|---------|
| Change batch size | 1 MB |
| Shared doc storage | 50 MB |
| Members per doc | 50 |
| Tunnel request body | 1 MB |
| Live subscribers per doc | 100 |
| Live subscribe deadline | 5 s |

`POST /v1/docs/{docId}/snapshots` is subject to the change batch size (HTTP `413`) and the
shared doc storage limit (HTTP `507`), like change batches.

**Rate limits.** In-memory token buckets (one relay process). Over the limit the relay answers
HTTP `429` with `Retry-After` (seconds).

| Bucket | Applies to | Default (burst, refill) |
|--------|------------|-------------------------|
| Client IP | `POST`/`PUT`/`PATCH`/`DELETE` on `/v1/*` (before signature checks), and every `/t/{tunnelId}/*` request | 120, 2/s |
| Signer key | `POST`/`PUT`/`PATCH`/`DELETE` on `/v1/*` (after the signature is verified) | 60, 1/s |
| Tunnel id | `/t/{tunnelId}/*` for a connected tunnel | 60, 1/s |

The client IP is the socket peer address, or the first `X-Forwarded-For` entry when the
operator enables `trustProxy` (only behind a trusted reverse proxy).

## Storage

The relay keeps everything in a single SQLite file and runs as one process, with no other
dependencies (self-hosting goal).
