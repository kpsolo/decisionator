# Data Model: Decision Engine Core (MVP)

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Conventions: IDs are ULIDs (sortable, generated on-device) unless noted. Timestamps are ISO-8601
UTC strings. `ActorRef` identifies who did something (see below). All markdown fields are
CommonMark, sanitized at render time. Schemas are defined in Zod in `packages/core/src/model/`
and exported as JSON Schema.

## Storage placement

| Store | Contents | Synced? |
|-------|----------|---------|
| **Workspace doc** (Automerge, one per node) | idea pool, decision index, idea sources' import records | local only (UI ↔ node) |
| **Decision doc** (Automerge, one per decision) | decision, options, contributions, ballots, outcomes, ACL mirror, agent request summaries | UI ↔ node; relay (encrypted) when shared |
| **Local state** (JSON files, `0600`) | identity keys, grant token hashes, plugin registry + settings, relay endpoints, decision keys | never |
| **Plugin store** (content-addressed dir) | installed plugin packages by SHA-256 | never |

## Shared value types

### ActorRef
| Field | Type | Notes |
|-------|------|-------|
| kind | `"human" \| "agent"` | |
| participantId | string | public-key fingerprint of the human (for agents: the human they act for) |
| displayName | string | human's display name at time of action |
| agentName | string? | required when `kind = "agent"`; self-declared (spec assumption) |
| agentRequestId | ULID? | required when `kind = "agent"` |

### SourceRef (provenance of imported ideas)
| Field | Type | Notes |
|-------|------|-------|
| pluginId | string | e.g. `org.deciginator.source.google-docs` |
| sourceType | string | plugin-defined, e.g. `google-doc`, `clipboard` |
| locator | string | e.g. document ID; empty for clipboard |
| itemKey | string | stable per-item key used for de-duplication (FR-014) |
| title | string? | human-readable source name |
| url | string? | link back to source |
| status | `"available" \| "unavailable"` | set when source becomes unreachable (edge case) |

---

## Entities

### Workspace (doc)
| Field | Type | Notes |
|-------|------|-------|
| id | AutomergeUrl | |
| ideas | Record<ULID, Idea> | idea pool |
| decisions | Record<ULID, DecisionIndexEntry> | `{docUrl, title, status, updatedAt, shared: bool, role}` |
| imports | Record<ULID, ImportRecord> | `{pluginId, locator, lastImportedAt, itemKeys[]}` |

### Idea
| Field | Type | Validation |
|-------|------|-----------|
| id | ULID | |
| title | string | 1–200 chars, trimmed |
| description | markdown | ≤ 20 000 chars |
| source | SourceRef? | absent for typed ideas |
| createdBy | ActorRef | |
| createdAt | timestamp | |
| linkedOptions | `{decisionId, optionId}[]` | maintained when added to a decision (FR-003) |
| archived | boolean | |

Uniqueness: at most one non-archived idea per `(source.pluginId, source.locator, source.itemKey)`.

### Decision (doc root)
| Field | Type | Validation / notes |
|-------|------|-----------|
| id | ULID | |
| schemaVersion | integer | starts at 1; migrations keyed on it |
| title | string | 1–200 chars |
| description | markdown | ≤ 20 000 chars |
| status | `"open" \| "decided" \| "archived"` | see state machine |
| owner | ParticipantId | |
| participants | Record<ParticipantId, Participant> | owner always present |
| options | Record<ULID, Option> | |
| optionOrder | ULID[] | ordering (FR-002) |
| strategy | `{pluginId, settings}`? | currently selected strategy for this decision |
| ballotMode | `"attributed" \| "anonymous"` | default `attributed` (FR-027c) |
| ballots | Record<ParticipantId, Ballot> | one active ballot per participant |
| contributions | Record<ULID, Contribution> | target may be decision or option |
| outcomes | Outcome[] | **append-only** (FR-008) |
| agentRequests | Record<ULID, AgentRequestSummary> | non-secret view of grants |
| auditLog | AuditEvent[] | append-only: refused agent actions, access changes |
| createdAt / updatedAt | timestamp | |

**State machine**

```text
open ──(outcome recorded)──▶ decided ──(decide again)──▶ decided (new outcome appended)
  │                            │
  └──────(archive)─────────────┴──▶ archived ──(unarchive)──▶ previous state
```

Deciding requires ≥ 2 options unless the strategy declares `minOptions: 1` (manual confirm).
Deleting a decision removes it locally; for a shared decision the owner's delete also revokes
all participants.

### Participant
| Field | Type | Notes |
|-------|------|-------|
| id | ParticipantId | fingerprint of Ed25519 public key |
| signingKey | base64 | Ed25519 public key |
| encryptionKey | base64 | X25519 public key |
| displayName | string | 1–60 chars |
| role | `"owner" \| "contribute" \| "view"` | |
| addedBy / addedAt | ParticipantId / timestamp | |
| revokedAt | timestamp? | revoked participants keep history attribution |

Role permissions:

| Action | owner | contribute | view | agent (via grant) |
|--------|:-----:|:----------:|:----:|:-----------------:|
| read decision | ✓ | ✓ | ✓ | scope only |
| add/edit options, notes | ✓ | ✓ | – | propose only (`add_option` → pending) |
| create agent request | ✓ | ✓ | – | – |
| cast ballot | ✓ | ✓ | – | – |
| record outcome | ✓ | – | – | **never** |
| review agent contributions | ✓ | own agents' | – | – |
| share / revoke / delete | ✓ | – | – | – |

### Option
| Field | Type | Validation |
|-------|------|-----------|
| id | ULID | |
| title | string | 1–200 chars; duplicates allowed but flagged in UI |
| description | markdown | ≤ 20 000 chars |
| weight | number? | ≥ 0, used by weighted strategy |
| originIdeaId | ULID? | FR-003 |
| source | SourceRef? | copied from idea |
| status | `"active" \| "proposed" \| "removed"` | agent-proposed options start `proposed` |
| createdBy | ActorRef | |
| createdAt / updatedAt | timestamp | |

Removing an option sets `status = removed` (history and past outcomes stay intact) and cancels
agent requests targeting it.

### Contribution
| Field | Type | Validation |
|-------|------|-----------|
| id | ULID | |
| target | `{kind: "decision"} \| {kind: "option", optionId} \| {kind: "idea", ideaId}` | idea contributions live in the workspace doc |
| type | `"note" \| "research" \| "pros_cons" \| "link"` | |
| body | markdown | ≤ 64 KB |
| pros / cons | string[]? | for `pros_cons`, ≤ 50 items each |
| sources | `{title, url, accessedAt?}[]` | ≤ 20; `url` must be http(s) |
| author | ActorRef | |
| reviewStatus | `"pending" \| "accepted" \| "edited" \| "dismissed"` | humans' own contributions are `accepted` at creation |
| reviewedBy / reviewedAt | ParticipantId / timestamp | |
| editedBody | markdown? | set when `edited`; original kept |
| createdAt | timestamp | |

**Review state machine** (agent contributions):
`pending → accepted | edited | dismissed`; `dismissed → pending` (undo) allowed; no deletion.

### Ballot
| Field | Type | Notes |
|-------|------|-------|
| participantId | ParticipantId | key of the map; one active ballot (FR-027c) |
| kind | `"choice" \| "ranking" \| "score"` | strategy declares which it accepts |
| payload | `{optionId}` \| `{ranking: ULID[]}` \| `{scores: Record<ULID, number>}` | |
| sealed | base64? | in `anonymous` mode: payload encrypted to owner's X25519 key; `payload` omitted |
| castAt | timestamp | re-vote replaces the entry (never double-counted) |

### Outcome (immutable)
| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| chosen | ULID[] | ≥ 1 option IDs |
| strategy | `{pluginId, version, packageHash, settings}` | FR-007 |
| inputs | `{options: {id, title, weight?}[], ballots?: BallotSnapshot[]}` | snapshot at run time |
| seed | hex(32)? | present iff the strategy used randomness |
| explanation | markdown | produced by the strategy |
| triggeredBy | ActorRef | always `kind = human` (FR-022) |
| createdAt | timestamp | |
| verifications | `{by, at, result: "match" \| "mismatch" \| "strategy_unavailable"}[]` | appended by viewers (FR-009) |

### AgentRequest
Split between secret local state and a non-secret summary in the decision doc.

**Summary (decision doc)**

| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| target | Contribution target | |
| instruction | string | 1–4 000 chars |
| permissions | (`"read"` \| `"contribute"` \| `"propose_options"`)[] | default `read`, `contribute` |
| requestedBy | ParticipantId | |
| channel | `"local" \| "tunnel"` | tunnel = remote agent through relay (R8) |
| status | `"open" \| "completed" \| "revoked" \| "expired" \| "cancelled"` | |
| expiresAt | timestamp | default now + 24 h, max 30 days |
| contributionIds | ULID[] | |
| agentName | string? | first self-declared name seen |

**Grant (local state only, requesting node)**

| Field | Type | Notes |
|-------|------|-------|
| requestId | ULID | |
| tokenHash | hex | SHA-256 of bearer token; token shown once |
| decisionId | ULID | |
| scope | target + permissions | |
| expiresAt / revokedAt | timestamp | |
| counters | `{contributions, requestsThisMinute}` | limits from R8 |

**State machine**: `open → completed (agent calls complete_request) | revoked (user) |
expired (clock) | cancelled (target removed)`. Any non-`open` state rejects all calls.

### Plugin (local state)
| Field | Type | Notes |
|-------|------|-------|
| id | reverse-DNS string | from manifest |
| version | semver | |
| packageHash | hex | SHA-256 of package |
| manifest | PluginManifest | [contracts/plugin-manifest.schema.json](./contracts/plugin-manifest.schema.json) |
| enabled | boolean | |
| grantedPermissions | string[] | subset of manifest permissions approved by user (FR-029) |
| settings | JSON | validated against manifest `settingsSchema` |
| bundled | boolean | informational only — no behavioural difference (Principle I) |
| installedFrom | `"bundled" \| "file" \| url` | |
| lastError | `{at, message}`? | surfaced in plugin area (FR-033) |

### AuditEvent
| Field | Type | Notes |
|-------|------|-------|
| at | timestamp | |
| actor | ActorRef | |
| action | string | e.g. `agent.refused.record_outcome`, `share.revoke` |
| detail | string | human-readable |

### Relay records (relay side, see [contracts/relay-protocol.md](./contracts/relay-protocol.md))
| Record | Fields |
|--------|--------|
| SharedDoc | `docId`, `ownerKey`, `acl` (signed, versioned), `keyEpoch` |
| ChangeBatch | `docId`, `seq`, `keyEpoch`, `ciphertext`, `nonce`, `signerKey`, `signature`, `receivedAt` |
| Invite | `inviteId`, `docId`, `role`, `expiresAt`, `sealedKeyFor?` |
| Tunnel | `tunnelId`, `nodeKey`, `connectedAt` |

## Validation rules traced to requirements

| Rule | Requirement |
|------|-------------|
| Outcomes append-only; no API to edit/delete | FR-008, Principle VI |
| `triggeredBy.kind` must be `human` | FR-022 |
| Seed required when strategy manifest declares `usesRandomness` | FR-007, FR-009 |
| Agent writes limited to grant scope and permissions | FR-020, FR-022 |
| Agent contributions start `pending` | FR-021 |
| Re-vote replaces ballot | FR-027c |
| Import de-dup on `(pluginId, locator, itemKey)` | FR-014 |
| No secrets in decision/workspace docs or exports | FR-036 |
