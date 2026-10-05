# Contract: Sync/Relay Protocol — v1.0.0

> **Scope: post-MVP (US7, local-first mode).** The MVP shares projects through Google Drive ([sheet-store.md](./sheet-store.md)).

The relay is a self-hostable service (`packages/relay`, Docker image). It carries **encrypted**
shared-decision changes and **agent tunnels**. It never holds decision keys
([research R6, R8](../research.md)).

## Authentication

Every HTTP request and every WebSocket hello is signed with the participant's Ed25519 key.

```text
X-Dcg-Key:       <base64 Ed25519 public key>
X-Dcg-Timestamp: <unix ms>                       (±120 s skew allowed; replay cache 5 min)
X-Dcg-Signature: <base64 sig over "METHOD\nPATH\nTIMESTAMP\nSHA256(body)">
```

## Shared documents

| Endpoint | Who | Purpose |
|----------|-----|---------|
| `PUT /v1/docs/{docId}` | owner | Create the shared doc. Body: `{acl: SignedAcl}`. |
| `PUT /v1/docs/{docId}/acl` | owner | Replace the ACL. Body: `SignedAcl` with `version` greater than the current one. Removing a member takes effect immediately. |
| `POST /v1/docs/{docId}/changes` | owner, contribute | Append a `ChangeBatch` (below). The relay checks the signer's role in the current ACL and assigns `seq`. |
| `GET /v1/docs/{docId}/changes?after={seq}` | members | Pull batches after a cursor. Paginated. |
| `WS /v1/docs/{docId}/live` | members | Push notifications of new `seq` (contains no content). |
| `POST /v1/docs/{docId}/snapshots` | owner, contribute | An encrypted compacted snapshot. Lets new members skip the full log. |
| `DELETE /v1/docs/{docId}` | owner | Delete everything stored for the doc. |

```ts
type SignedAcl = {
  docId: string; version: number; keyEpoch: number;
  members: { key: string; encKey: string; role: "owner" | "contribute" | "view" }[];
  ownerSignature: string;                  // Ed25519 over canonical JSON of the fields above
};

type ChangeBatch = {
  keyEpoch: number;                        // which decision key encrypted it
  nonce: string;                           // 24-byte XChaCha20 nonce, base64
  ciphertext: string;                      // XChaCha20-Poly1305(Automerge change bytes[]), base64
  signerKey: string;
  signature: string;                       // Ed25519 over (docId ‖ keyEpoch ‖ nonce ‖ ciphertext)
};
```

**Client-side checks.** Clients also verify the signature on every change and check the
signer's role against the ACL in effect. A batch from a non-writer is discarded even if the
relay accepted it. This protects against a compromised relay.

## Invites (two-step, keys never in query strings)

1. The owner calls `POST /v1/docs/{docId}/invites` with `{role, expiresAt}` and gets back
   `inviteId`. The owner then shares the link
   `decisionator://join?relay=<url>&invite=<inviteId>` (or its https equivalent on the relay).
2. The invitee's node calls `POST /v1/invites/{inviteId}/accept` with its public keys.
   The relay queues the request for the owner.
3. The owner's node, while online, confirms the invite. It adds the member to the ACL and posts
   `sealedKey = sealedBox(X25519(invitee), decisionKey[epoch])` to
   `/v1/invites/{inviteId}/key`.
4. The invitee fetches the sealed key, decrypts it locally and pulls the changes.

**Revocation.** The owner publishes a new ACL without the member and with `keyEpoch + 1`. It
then distributes the new key, sealed to each remaining member. Later batches use the new epoch.

## Agent tunnel

| Endpoint | Purpose |
|----------|---------|
| `WS /v1/tunnels` | The node connects, with a signed hello, and receives a `tunnelId`. The relay keeps it open. |
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

## Storage

The relay keeps everything in a single SQLite file and runs as one process, with no other
dependencies (self-hosting goal).
