# Data Model: Decision Engine Core

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Conventions

- IDs are ULIDs generated in the browser.
- Timestamps are ISO-8601 UTC.
- Markdown fields are CommonMark, sanitized when rendered.
- Schemas are Zod definitions in `packages/core/src/model/`, exported as JSON Schema.
- Storage-specific layout is defined by each store: Google Sheets in
  [contracts/sheet-store.md](./contracts/sheet-store.md), local mode (US7) in
  [contracts/relay-protocol.md](./contracts/relay-protocol.md).

## Storage placement (MVP)

| Store | Contents |
|-------|----------|
| **Project Sheet** (owner's Google Drive) | meta, options, grades, comments, rankings, outcomes. Encrypted payloads in password mode |
| **Browser IndexedDB** | drafts (pasted text, preview), outgoing write queue, last snapshot per project (offline view), UI preferences |
| **Memory only** | Google access token, password-derived key |

---

## MVP entities

### Identity / Participant
| Field | Type | Notes |
|-------|------|-------|
| participantId | string | MVP: Google account email from Drive `about.get`; US7: public-key fingerprint |
| displayName | string | from Google profile; shown on grades, comments and rankings |
| role | `"owner" \| "contribute" \| "view"` | derived from Drive permission: owner, writer, reader |

Role permissions (MVP):

| Action | owner | contribute | view |
|--------|:-----:|:----------:|:----:|
| view project, stats, results (if visible) | ✓ | ✓ | ✓ |
| grade, comment, submit ranking | ✓ | ✓ | – |
| edit own comments | ✓ | ✓ | – |
| add, edit or remove options; edit project title or description | ✓ | – | – |
| open or close voting, settings, hide others' comments | ✓ | – | – |
| share, change access, set password | ✓ | – | – |
| delete project (Drive trash) | ✓ | – | – |
| remove project from own list (local) | ✓ | ✓ | ✓ |

### Project
| Field | Type | Validation / notes |
|-------|------|-----------|
| ref | `{store: "google-sheets", fileId}` | US7: `{store: "local", docId}` |
| title | string | 1–200 chars |
| description | markdown | ≤ 20 000 chars |
| owner | participantId | |
| protected | boolean | password mode (FR-017) |
| kdf | `{alg: "pbkdf2-sha256", iterations: 600000, salt}` | present iff protected |
| voting | `{state: "open" \| "closed", round: int ≥ 1, topN: 1–10 (default 3), liveResults: bool}` | |
| createdAt | timestamp | |
| formatVersion | `1` | |

**Voting state machine**: `open(round n) → closed(round n)` creates an Outcome.
`closed(round n) → open(round n+1)` lets people re-vote: a new round, where ballots from earlier
rounds no longer count.

### Option
| Field | Type | Validation |
|-------|------|-----------|
| id | ULID | |
| order | int | display order |
| status | `"active" \| "removed"` | removed options keep their history and are excluded from new tallies |
| title | string | 1–200 chars; duplicates allowed, flagged |
| description | markdown | ≤ 20 000 chars |
| category | string? | ≤ 60 chars; "group by category" |
| tags | string[] | ≤ 10, each ≤ 40 chars |
| pros, cons | string[] | ≤ 20 each |
| effort | `XS \| S \| M \| L \| XL`? | |
| links | `{title?, url}[]` | ≤ 10, http(s) |
| at / by | timestamp / participantId | |

Option fields mirror [contracts/options-format.schema.json](./contracts/options-format.schema.json).

### Grade (append-only)
| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| optionId | ULID | must exist |
| value | 1–5 | |
| at / by | timestamp / participantId | stamped by the store |

**Effective grade** = the latest row per (by, optionId).

### Comment (append-only)
| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| optionId | ULID | |
| body | markdown | 1–10 000 chars |
| replaces | ULID? | an edit, or a hide/unhide, of an earlier comment |
| hidden | boolean? | only the owner may hide others' comments |
| at / by | timestamp / participantId | |

**Effective comment** = the latest row in its `replaces` chain. Hidden comments are shown only in
history.

### Ranking / Ballot (append-only)
| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| round | int | the voting round it belongs to |
| ranking | ULID[] | ordered, unique, active options, length 1..topN |
| at / by | timestamp / participantId | |

**Effective ballot** = the latest row per (by, round), submitted while the round was open.
Rows submitted after the close time are ignored, using `at` compared with the outcome's `at`.

### Outcome (append-only, immutable)
| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| round | int? | for ranked-vote outcomes |
| strategy | `{id, version}` | e.g. `org.decisionator.strategy.borda@1.0.0` |
| settings | object | e.g. `{topN: 3}` |
| inputs | `{options: {id, title}[], ballots: {by, ranking}[], grades: {optionId, average, count}[]}` | snapshot at close |
| result | `{winner: ULID, chosen?: ULID[], order: {optionId, points?, firstPlaces?}[], explanation?}` | `points`/`firstPlaces` only for ranked (Borda) outcomes |
| tieBreak | `"none" \| "average-grade" \| "first-places" \| "seeded-random"` | |
| seed | hex(32)? | only when `seeded-random` was needed (R11 RNG) |
| triggeredBy | participantId | the owner |
| at | timestamp | |

### Stats (derived, never stored)
Computed in the browser from a snapshot (FR-013). For each active option:
- `average` (1 decimal), `count`, and the distribution `[n1..n5]`;
- `comments` (visible count);
- `bordaPoints` and `firstPlaces` (current round, if visible).

Views:
- sort by any of `average`, `count`, `comments`, `bordaPoints`, `title`;
- group by `category` or tag (an option with several tags appears under each).

### Draft (browser only)
| Field | Type | Notes |
|-------|------|-------|
| id | ULID | |
| pastedText | string | ≤ 200 KB |
| aiAnswer | string? | raw paste from the AI |
| preview | Option[] | edited candidates |
| warnings | string[] | from extraction and validation |
| updatedAt | timestamp | |

### Queued write (browser only)
`{projectRef, entry, queuedAt, attempts}`. Flushed by the store; survives reloads (FR-020).

---

## Post-MVP entities (summary; full detail moves into each story's increment)

| Entity | Story | Key fields |
|--------|-------|-----------|
| **Contribution** | US5 | target (option), type (note, research, pros_cons, link), body, sources[], author `{kind: human \| agent, agentName?, onBehalfOf}`, reviewStatus (pending → accepted \| edited \| dismissed) |
| **AgentRequest / Grant** | US5 | instruction, target, permissions (read, contribute, propose_options), expiresAt (default 24 h), revokedAt, token hash (local only), limits ([contracts/agentic-api.md](./contracts/agentic-api.md)) |
| **Plugin** | US6 | id, version, packageHash, manifest ([contracts/plugin-manifest.schema.json](./contracts/plugin-manifest.schema.json)), enabled, grantedPermissions, settings, lastError |
| **Idea / SourceRef** | US6 | imported item with `{pluginId, sourceType, locator, itemKey, url, status}` for de-duplication ([contracts/idea-source.md](./contracts/idea-source.md)) |
| **Device identity, ACL, ChangeBatch** | US7 | Ed25519/X25519 keys, signed ACL, encrypted change log ([contracts/relay-protocol.md](./contracts/relay-protocol.md)) |
| **AuditEvent** | US5 / US7 | refused agent actions, access changes |

## Validation rules traced to requirements

| Rule | Requirement |
|------|-------------|
| Grades, comments, rankings and outcomes are append-only; author stamped by the store | FR-009, FR-024 |
| One effective grade per (participant, option); one effective ballot per (participant, round) | FR-012, FR-021 |
| Ballot length ≤ topN; only active options; unique | FR-021 |
| Outcome records strategy, inputs snapshot, tie-break and seed | FR-024, SC-006 |
| Only the owner writes `options`, `meta` and `outcomes` | data-model role matrix |
| Password-mode payloads encrypted; the key is never stored | FR-017, SC-007 |
| No tokens or passwords in Sheet, export or share link | FR-081 |
| Invalid or foreign rows skipped with a warning, never fatal | spec edge cases |
