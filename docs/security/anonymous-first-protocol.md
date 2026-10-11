# Anonymous-First Protocol: Architectural Principles & Operational Mandates

**Version**: 1.0.0 | **Ratified**: 2026-10-11 | **Status**: Mandatory  
**Precedence**: Governs all user experiences, protocol wire formats, and storage systems across the Deci engine.

---

## 1. Core Principle: Anonymous-First Deliberation

In many group decision tools, user identity is prematurely demanded, tracked, and weaponized: people hesitate to speak honestly, vote objectively, or grade controversial options when their permanent identity is tethered to their inputs.

Deci establishes an **Anonymous-First Architecture**:
> *Every feature, storage plugin, transport channel, and user interface MUST default to anonymous or pseudonymous participation. Real identities, accounts, and telemetry MUST NOT be required to participate in, evaluate, or finalize a decision.*

---

## 2. Seven Mandatory Mandates

### Mandate 1: Zero Required PII (No Registration, No Accounts)
- Joining a live session or creating a local decision MUST NEVER require an account, email address, phone number, SSO login, or OAuth profile.
- A user opening a shared join link (`#/join/...`) MUST immediately enter the deliberation room without an onboarding funnel.
- Any display name requested from a participant is purely local cosmetic metadata for the duration of that session.

### Mandate 2: Default Pseudonymity & Random Numbering
- When a participant joins without typing a name, the host MUST assign a neutral, pseudonymous label (e.g. `Guest 1`, `Guest 2`).
- If a guest enters a common name (e.g. `Alex`), collisions are resolved deterministically and neutrally (e.g. `Alex 2`), never by inspecting device details or querying external identity directories.

### Mandate 3: Cryptographic Cross-Session Unlinkability
- A participant's identity in session $S_1$ MUST NOT be linkable to their identity in session $S_2$:
  $$\text{participantId}_{S_1} \ne \text{participantId}_{S_2}$$
- The device secret MUST remain in local browser storage and MUST NOT be transmitted to hosts, relays, or peers.
- No cross-site or cross-session tracking identifiers (cookies, canvas fingerprints, E-Tags, or local storage super-cookies) may be generated or stored.

### Mandate 4: Secret Ballots During Active Deliberation
- While a voting round is in progress and live results are not explicitly set to public, individual voting rankings and ballots MUST remain confidential.
- The host engine MUST redact other participants' ballots from all broadcast snapshots.
- A peer's ballot is revealed only in aggregate or after deliberation voting concludes, preventing social pressure or bandwagon effects.

### Mandate 5: Zero Telemetry & Zero Third-Party Trackers
- The client application MUST NOT bundle or invoke any third-party tracking, analytics, or behavioral surveillance scripts (e.g. Google Analytics, Mixpanel, Sentry session replays, Meta Pixels).
- Application errors and diagnostic messages MUST be presented locally to the user in human-readable terms without silently beaconing stack traces or user text to remote servers.
- Network requests MUST be confined strictly to user-configured storage endpoints, Nostr relays, and WebRTC peer connections.

### Mandate 6: URL Hash Fragment Confidentiality
- All join credentials, session keys, and secrets MUST be placed exclusively after the URL fragment identifier (`#`), for example:
  `https://app.deci.city/#/join/:sessionId/:secret/:hostKey`
- Because web standards specify that URL fragments are not sent in HTTP `GET` request headers, hosting servers, CDN caches, and reverse proxies never log join credentials or deliberation keys in access logs.

### Mandate 7: Pseudonymous AI Agent Interactions
- When AI agents are invited to inspect a deliberation or propose moderation actions, human identities MUST NOT be disclosed to the agent.
- Participant IDs exposed through the Agentic API (`packages/node`) MUST be dynamically mapped to ephemeral per-grant pseudonyms (e.g. `anon-1`, `anon-2`).
- Agents MUST NOT be given raw device secrets, IP addresses, or historical deliberation links.

---

## 3. Data Disposal & The Right to Disappear

Participants have the absolute right to purge all traces of their participation from their devices:
1. **One-Click Local Cache Purge**:
   - The Joined Sessions view provides a prominent **"Remove from device"** action.
   - Clicking this permanently removes the IndexedDB deliberation record, the URL secret, and all cached snapshots.
2. **LRU Cache Capping**:
   - Guest devices automatically evict older cached sessions (retaining at most 30 sessions) on a least-recently-used basis to prevent accumulating persistent trails.
3. **Relay Retraction**:
   - Owners ending or revoking a deliberation can purge snapshots from public Nostr relays with a single click, publishing a signed tombstone that replaces the encrypted record.

---

## 4. Verification & Audit Standard

Every code change, plugin addition, or protocol update MUST be checked against the Anonymous-First rules:
- Any pull request introducing a mandatory registration wall, tracking script, or cross-session tracking mechanism is a **CRITICAL failure** under Constitution Principle V and this protocol.
- The automated security verification test suite (`pnpm verify:security`) enforces zero token leakage, correct URL fragment formatting, and snapshot ballot redaction.
