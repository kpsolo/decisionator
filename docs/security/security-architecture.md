# Security Architecture & Cryptographic Specifications

**Version**: 1.0.0 | **Ratified**: 2026-10-11 | **Status**: Active  
**Compliance**: [Constitution Principle V (User Owns the Data)](file:///c:/Work/deciginator/.specify/memory/constitution.md#L90) & [Principle VI (Transparent, Reproducible Decisions)](file:///c:/Work/deciginator/.specify/memory/constitution.md#L105)

---

## 1. Executive Summary & Design Philosophy

Deci is designed under a **Zero-Trust, Zero-Knowledge, Anonymous-First** security model. The architecture minimizes data exposure across all boundaries:
- **No centralized user accounts**: Anyone can host or participate in a collaborative deliberation anonymously without registering, supplying emails, or undergoing identity verification.
- **Client-Side Cryptography**: Encryption and key derivation occur exclusively within the user's browser runtime using standard Web Cryptography and audited pure-JavaScript primitives (`@noble/ciphers`, `@noble/hashes`, `@noble/curves`).
- **Zero-Knowledge Relays**: Intermediary signaling relays (Nostr) and network transports (WebRTC STUN/TURN) never receive plaintext decision contents, option names, participant identities, or session keys.
- **Client-Side E2EE in Cloud Stores**: Deliberations saved to cloud stores (e.g. Firebase Firestore) are encrypted client-side using PBKDF2 (600,000 iterations) and AES-256-GCM. Cloud database administrators cannot inspect project deliberations.
- **Ephemeral Credentials**: Third-party OAuth tokens (e.g. Google Drive/Sheets) exist exclusively in browser memory and are never persisted to disk, local storage, or project files.

---

## 2. Storage Security & Data at Rest

Deci supports four pluggable storage backends. Each backend satisfies strict isolation and least-privilege guarantees:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Browser Sandbox                            │
│                                                                        │
│  ┌───────────────────────┐                  ┌───────────────────────┐  │
│  │   store-file          │                  │   store-local         │  │
│  │   Local JSON files    │                  │   IndexedDB Sandbox   │  │
│  │   (User disk custody) │                  │   (Same-Origin)       │  │
│  └───────────────────────┘                  └───────────────────────┘  │
│                                                                        │
│  ┌────────────────────────────────────────┐ ┌───────────────────────┐  │
│  │   store-firestore (Client E2EE)        │ │  store-google-sheets  │  │
│  │   Plaintext ──► AES-256-GCM (PBKDF2)   │ │  In-Memory Token      │  │
│  └───────────────────┬────────────────────┘ └───────────┬───────────┘  │
└──────────────────────┼──────────────────────────────────┼──────────────┘
                       ▼ (Ciphertext only)                ▼ (HTTPS + OAuth)
             ┌───────────────────┐             ┌─────────────────────────┐
             │  Cloud Firestore  │             │  Google Sheets / Drive  │
             └───────────────────┘             └─────────────────────────┘
```

### 2.1 Local File Storage (`plugins/store-file`)
- **Custody**: 100% on the user's local filesystem.
- **Transport**: Native file picker or browser download.
- **Protection**: Subject to operating system user file access permissions.
- **Guarantees**: No remote network requests are initiated during save or load.

### 2.2 Local IndexedDB Storage (`plugins/store-local`)
- **Custody**: Stored inside browser IndexedDB database `decisionator-store`.
- **Isolation**: Bound strictly to the web origin by the browser's Same-Origin Policy (SOP).
- **Guest Cache Disposal**: Cached deliberations in `live_sessions` can be deleted with a single click ("Remove from device"), which immediately deletes the stored snapshot, participant ID, and URL secret.

### 2.3 Cloud Firestore Storage with E2EE (`plugins/store-firestore`)
When users choose remote cloud persistence via Firestore, data is encrypted **before** leaving the browser:
- **Key Derivation (KDF)**:
  $$\text{key} = \text{PBKDF2-HMAC-SHA256}(\text{password}, \text{salt}_{16}, \text{iterations}=600\,000, \text{length}=256)$$
  *Note: 600,000 iterations complies with current OWASP password storage recommendations.*
- **Cipher**: **AES-256-GCM** with a fresh, cryptographically secure 12-byte initialization vector (IV) per entry:
  $$\text{payload} = \text{"enc:v1:"} \parallel \text{base64}(\text{IV}_{12}) \parallel \text{":"} \parallel \text{base64}(\text{ciphertext})$$
- **Verifier**: A zero-knowledge password verifier is derived by encrypting a known constant `decisionator:verifier:v1`. The password is never sent to the server.
- **Non-Extractable**: Keys are created as non-extractable `CryptoKey` objects in Web Crypto, preventing memory dumping by third-party scripts.
- **Server Knowledge**: Google Cloud Firestore receives only opaque encrypted strings. Even in a catastrophic cloud breach, data cannot be decrypted without the user's password.

### 2.4 Google Sheets & Google Drive Storage (`plugins/store-google-sheets`)
- **Authentication**: Uses Google Identity Services (GIS) OAuth 2.0 token client.
- **Ephemeral Token Lifecycle**: Access tokens are held in a private JavaScript instance property in memory (`GoogleAuthService.currentToken`).
- **Zero Token Leakage**: Tokens are **never** written to `localStorage`, `sessionStorage`, IndexedDB, cookies, URL fragments, or project exports (Principle V).
- **Scope Minimization**: Requests only minimal scopes (`https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/spreadsheets`), granting access only to files explicitly created or opened by Deci.

---

## 3. Protocol & Wire Security: Live Deliberation

Live sharing is coordinated over a peer-to-peer star topology where the session creator's browser acts as the authoritative host.

```
                    ┌────────────────────────────┐
                    │    Public Nostr Relays     │
                    │    (Zero-Knowledge PubSub) │
                    └───────┬────────────▲───────┘
          Sealed Offer /    │            │ Sealed Answer /
          Replaceable NIP-78│            │ Ephemeral Kind 25050
                            ▼            │
                    ┌────────────────────────────┐
                    │     Live Session Host      │
                    │   (Authoritative Engine)   │
                    └──────▲──────────────▲──────┘
                           │              │
             WebRTC Data   │              │ WebRTC Data
             Channel (DTLS)│              │ Channel (DTLS)
                           ▼              ▼
                     ┌───────────┐  ┌───────────┐
                     │  Guest 1  │  │  Guest 2  │
                     └───────────┘  └───────────┘
```

### 3.1 Signaling Over Nostr (Zero-Knowledge Rendezvous)
WebRTC handshakes (SDP offers, answers, ICE candidates) require a signaling channel. Deci utilizes public Nostr relays without exposing metadata:
- **Session Credentials in URL Fragment**:
  Share links take the form:
  `https://app.deci.city/#/join/:sessionId/:secret[/:hostKey]`
  The fragment (`#`) is **never** sent to the web hosting server in HTTP request headers.
- **Key & Topic Derivation**:
  $$\text{IKM} = \text{utf8}(\text{sessionId} \parallel 0 \parallel \text{secret})$$
  $$\text{OKM} = \text{HKDF-SHA256}(\text{IKM}, \text{salt}=\text{"deci-live/2"}, \text{info}=\text{"signal+topic"}, \text{length}=64)$$
  $$\text{signalKey} = \text{OKM}[0..32], \quad \text{topic} = \text{hex}(\text{OKM}[32..64])$$
- **Sealing Envelope**:
  Every signaling message is sealed using AES-256-GCM with authenticated associated data ($\text{AAD} = \text{topic}$):
  $$\text{content} = \text{base64url}(\text{IV}_{12} \parallel \text{AES-GCM}(\text{signalKey}, \text{IV}_{12}, \text{payload}, \text{AAD}=\text{topic}))$$
- **Relay Privacy**: Relays see only Nostr `kind: 25050` events tagged with `["t", topic]` containing random-looking ciphertext. Relays cannot read SDP offers, IP candidates, participant names, or project details.

### 3.2 Host Authenticity & Anti-Forgery (NIP-78 Sealed Snapshots)
To support asynchronous deliberation when the host is offline, the host publishes replaceable sealed snapshots (`kind: 30078`) to Nostr relays.
- **Vulnerability Mitigated**: Because any guest holding the link knows `signalKey` and `topic`, an untrusted guest could theoretically publish fake snapshots or fake deletion markers.
- **Host Signing Keypair**:
  The host generates a 256-bit `relaySecret` stored solely in host browser `localStorage`.
  $$\text{hostKeyPair} = \text{schnorrKeyFrom}(\text{HKDF-SHA256}(\text{relaySecret}, \text{"deci-live/relay"}, \text{sessionId}))$$
- **Verification Rule**:
  - The public `hostKey` is appended to the join link and included in `welcome` frames.
  - Relays store events keyed by `(pubkey, kind, d)`. Only the host key can overwrite the host's record.
  - Guests filter relays with `authors: [hostKey]` and verify Schnorr signatures before unsealing.
  - Forged relay records published by unauthorized link holders are rejected.

### 3.3 WebRTC Data Channel Security
- **Encryption**: Data channel frames travel directly between host and guest browsers over DTLS 1.2/1.3.
- **No Third-Party Relay**: Media/data does not pass through external application servers. If TURN servers are configured for NAT traversal, they see only encrypted DTLS packets.

---

## 4. Anonymous Identity & Anti-Spoofing Cryptography

Deci provides strong cryptographic guarantees that protect guest anonymity while preventing voter impersonation:

### 4.1 Cryptographic Identity Derivation
1. On first use, the guest generates a 32-byte `deviceSecret` stored locally:
   $$\text{deviceSecret} = \text{globalThis.crypto.getRandomValues}(32)$$
2. For each live session, the guest derives a deterministic session key:
   $$\text{sessionKey} = \text{SHA256}(\text{"deci-live/participant"} \parallel \text{deviceSecret} \parallel \text{sessionId})$$
3. The guest derives their public `participantId`:
   $$\text{participantId} = \text{"peer:"} \parallel \text{SHA256}(\text{"deci-live/pid"} \parallel \text{sessionKey})[0..24]$$

### 4.2 Security & Anonymity Properties
- **No Voter Impersonation**: Because `participantId` is derived through a one-way hash from `sessionKey`, an attacker who sees Alice's `participantId` cannot forge votes as Alice. The host checks that submitted entries match the authenticated peer's session key.
- **Cross-Session Unlinkability**: Alice participating in "Project A" has a completely different `participantId` than in "Project B". Neither the host nor other participants can correlate that both sessions involve the same person.
- **Device Secret Isolation**: `deviceSecret` is never transmitted across the wire.

---

## 5. Policy Enforcement & Secret Ballots

The host acts as the authoritative gatekeeper, running validation rules on every received frame ([policy.ts](file:///c:/Work/deciginator/plugins/share-inpage/src/policy.ts)):

1. **Secret Ballot Protection**:
   - While a voting round is in progress and live results are disabled, the host redacts all other participants' rankings from broadcast snapshots.
   - Each guest receives only their own ballot until voting concludes.
2. **Owner Material Isolation**:
   - Owner-only AI agent drafts, unredacted historical logs, and hidden comments are stripped from all guest snapshots.
3. **Dynamic Read-Only Lock**:
   - When the host switches the deliberation to read-only, incoming submissions are rejected at the protocol layer with an Ack error (`code: "read_only"`), preventing modified clients from submitting late votes.
4. **Append-Only Moderation**:
   - When the host drops errant votes, it appends an explicit reset entry (`kind: "reset", scope: "participant"`). The project journal retains full auditability without in-place mutations (Principle VI).

---

## 6. Threat Model & Security Matrix

| Adversary | Capabilities | Mitigation & Guarantee |
|---|---|---|
| **Public Relay Operator** | Observes all Nostr traffic, can log and drop packets. | **Zero Knowledge**: All signaling envelopes and NIP-78 snapshots are AES-256-GCM encrypted. Relays see only pseudorandom ciphertext. Cannot forge records due to Schnorr signatures. |
| **Network Eavesdropper / ISP** | Intercepts HTTP/WebSocket traffic. | **TLS + DTLS**: WebRTC data channels use DTLS. Join link secrets live in URL fragments (`#`) and are never transmitted in HTTP headers. |
| **Malicious Participant with Join Link** | Can connect, send raw JSON frames, attempt to forge votes or alter session. | **Host Policy Enforcement**: Host strictly validates entry author keys. Cannot impersonate other voters. Cannot forge host snapshots. Submissions rejected if session is read-only. |
| **Cloud Storage Compromise (Firestore)** | Attacker gains full read access to remote database. | **Client-Side E2EE**: All document bodies are stored as `enc:v1:<iv>:<ciphertext>`. Unreadable without user password and 600k PBKDF2 key derivation. |
| **Stolen Export File** | Attacker obtains an exported `.json` or `.xlsx` file. | **Zero Credential Bleed**: Export bundles contain only decision content and author display names. OAuth tokens, host signing keys, and device secrets are never exported. |
