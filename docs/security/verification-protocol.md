# Security & Anonymity Verification Protocol

**Version**: 1.0.0 | **Ratified**: 2026-10-11 | **Status**: Active  
**Companion Documents**:
- [Security Architecture & Cryptographic Specifications](./security-architecture.md)
- [Anonymous-First Protocol](./anonymous-first-protocol.md)

---

## 1. Purpose & Verification Scope

This protocol establishes the mandatory criteria, test procedures, and automated tooling required to verify that the Deci codebase maintains its zero-knowledge, end-to-end encrypted, and anonymous-first guarantees across all storage backends, wire protocols, and agent interfaces.

Verification MUST pass before merging pull requests and before tagging any release.

---

## 2. The Eight Security Verification Gates

Every audit or verification pass validates eight distinct security gates:

### Gate 1: Cryptographic Parameter Integrity
- **KDF Iterations**: Firestore key derivation MUST use $\ge 600\,000$ iterations of PBKDF2-HMAC-SHA256 with 16-byte random salts.
- **Cipher**: Cloud encryption MUST produce `enc:v1:<iv12>:<ct>` using AES-256-GCM with fresh 12-byte random IVs per call.
- **Relay Signatures**: Ed25519 and Schnorr signatures MUST verify correctly and reject skewed timestamps (> 120 s).

### Gate 2: Zero Token & Credential Leaks in Exports and Storage
- **Static Scan**: Neither OAuth access tokens, Google refresh tokens, host signing keys (`relaySecret`), nor device secrets may appear in:
  - Exported JSON or XLSX files.
  - Project entries or journals.
  - WebRTC broadcast snapshot frames.
  - `localStorage` outside designated isolated keys (`deci.live.host.*`, `deci.device.secret`).

### Gate 3: Relay Zero-Knowledge & Sealed Signaling
- **Ciphertext Audit**: Signaling frames published to Nostr relays (`kind: 25050` and `kind: 30078`) MUST contain only base64url ciphertext sealed with AES-256-GCM.
- **No Plaintext Bleed**: Scanning raw WebSocket frames for project titles, option names, or voter identities MUST return zero matches.

### Gate 4: Host Authenticity & Anti-Forgery
- **Schnorr Verification**: Replaceable Nostr snapshots (`kind: 30078`) MUST be signed by the host Schnorr keypair.
- **Drop Spoofed Records**: Guests MUST reject any relay event whose signature does not match `hostKey` before decrypting.

### Gate 5: Identity Unforgeability & Cross-Session Unlinkability
- **One-Way Identity Derivation**: Verify that knowing a guest's `participantId` gives zero ability to derive `sessionKey` or `deviceSecret`.
- **Unlinkability Test**: Given the same `deviceSecret`, participating in two distinct sessions ($S_1$ and $S_2$) MUST produce two completely uncorrelated `participantId` strings with zero common substrings.

### Gate 6: Secret Ballot Secrecy & Snapshot Redaction
- **Active Voting Privacy**: When a voting round is active and live results are disabled, `redactSnapshotFor` MUST strip all rankings except the recipient's own ballot.
- **Isolation of Drafts**: Owner AI drafts, unredacted historical resets, and hidden comments MUST be excluded from guest snapshots.

### Gate 7: Host Policy Enforcement & Read-Only Immobility
- **Server-Side Enforcement**: When a session is in view-only mode (`role === "view"`), raw `submit` messages sent over the data channel MUST be refused with Ack `{ ok: false, code: "read_only" }`.
- **UI Lock**: Guest controls MUST be disabled and show "The host made this session view-only."

### Gate 8: Anonymous-First & URL Fragment Integrity
- **Fragment Confinement**: All join link URLs MUST place session IDs, secrets, and host keys behind the `#` fragment identifier (`#/join/...`).
- **Zero PII**: No database table, form field, or wire schema may require email, phone, or legal name to join or vote.

---

## 3. Automated Verification Tooling

To ensure non-regression, an automated verification script runs all static, cryptographic, and redaction checks in a single command.

### 3.1 Running the Security Verification Suite

```bash
# Run the automated security & anonymity verification suite
pnpm verify:security
```

Or run directly via Node:
```bash
node scripts/verify-security.mjs
```

### 3.2 Running the Cryptographic Contract Tests

```bash
# Run core crypto & relay cryptographic tests
pnpm vitest run packages/core/test/crypto.test.ts packages/core/test/relay-crypto.test.ts

# Run live share transport & policy contract tests
pnpm vitest run plugins/share-inpage/test
```

---

## 4. Continuous Integration (CI) Enforcement

The GitHub Actions CI pipeline enforces this protocol on every pull request:
1. `pnpm lint` — Enforces code quality and forbids forbidden patterns.
2. `pnpm test` — Executes all unit and contract tests.
3. `pnpm verify:security` — Executes the 8-gate security and anonymity audit.

If any check fails, the pull request cannot be merged.
