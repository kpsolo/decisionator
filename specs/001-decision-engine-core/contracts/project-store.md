# Contract: Project Store — v1.2.0

The extension point that keeps project storage pluggable (spec FR-011, Principle I).
- MVP implementation: `store-google-sheets` ([sheet-store.md](./sheet-store.md)).
- Later: `store-local`, using Automerge and the relay (US7).
- Third parties could add others, such as Notion or Airtable.

Platform key: `platform.projectStore`. The host calls the store; the UI never talks to Google
directly.

## Interface (TypeScript, `@decisionator/plugin-sdk`)

```ts
interface ProjectStore {
  readonly id: string;                                   // e.g. "org.decisionator.store.google-sheets"
  signIn(opts?: { interactive: boolean }): Promise<Identity>;          // { participantId, displayName, email? }
  listProjects(): Promise<ProjectSummary[]>;                           // "My projects" (FR-010)
  createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef>;
  openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot>;
  watch(ref: ProjectRef, onChange: (s: ProjectSnapshot) => void): Unsubscribe;   // FR-019
  append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult>; // grades, comments, rankings, outcomes
  updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void>;      // owner only
  updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void>;        // owner only (voting state, settings)
  share(ref: ProjectRef, req: ShareRequest): Promise<ShareState>;      // link on/off + role, invite/remove email (FR-015, FR-018)
  getShareState(ref: ProjectRef): Promise<ShareState>;
  export(ref: ProjectRef): Promise<ExportBundle>;                      // FR-080
  deleteProject(ref: ProjectRef): Promise<void>;                       // owner only; Google: Drive trash (FR-025)
  forgetProject(ref: ProjectRef): Promise<void>;                       // any participant: drop local data and list entry
}

type Entry =
  | { kind: "grade"; optionId: string; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: "comment"; optionId: string; body: string; hidden?: boolean; replaces?: string }
  | { kind: "ranking"; ranking: string[] }                       // ordered option ids, length ≤ topN
  | { kind: "outcome"; outcome: OutcomeRecord }
  | { kind: "contribution"; contribution: Contribution };

interface Delegate {
  participantId: string;      // stamped as `by`; non-blank, at most 200 characters
  displayName?: string;       // stamped as `byName`; 1–80 characters after trimming
}

interface AppendOptions {
  onBehalfOf?: Delegate;      // v1.2.0: owner records entries for another participant
}
```

`Grade`, `Comment` and `Ranking` carry an optional `byName` (1–80 characters): the display name of
a delegated author. Entries of signed-in authors have no `byName`.

`ProjectSnapshot` is the full, validated, decrypted state as described in
[data-model.md](../data-model.md). The host computes stats and tallies from snapshots. Stores
only persist.

## Rules

1. The store authenticates the author of every entry. Entries are stamped with
   `participantId` and `at` by the store, never taken from the caller.
2. `append` never modifies or deletes existing entries (FR-009, FR-024).
3. A store that cannot provide a capability throws `NOT_SUPPORTED` with a user-readable message.
   For example, individual removal for link-shared projects in Google, per research R21.
4. Rate limiting, queueing and backoff (FR-020) belong to the store. `AppendResult` reports
   `{queued: n, sent: n}` so the UI can show "syncing paused".
5. With a `password`, the store encrypts all content before it leaves the browser (FR-017).
6. **Delegated append (v1.2.0).** `append(ref, entries, { onBehalfOf })` lets the project owner
   record entries for another participant, e.g. a guest of a live session relayed through the
   owner's tab, or the original author when a project is moved between stores.
   - Without `onBehalfOf` nothing changes: entries are stamped with the signed-in user (rule 1).
   - Only the project **owner** may delegate. A non-owner gets an error whose message starts with
     `PERMISSION_DENIED`.
   - Only `grade`, `comment` and `ranking` entries may be delegated. A delegated call that contains
     an `outcome` or `contribution` entry is rejected with `PERMISSION_DENIED`, and nothing from
     that call is written: the store validates the whole call before writing.
   - `participantId` must be a non-blank string of at most 200 characters, and `displayName`, when
     present, 1–80 characters after trimming. Otherwise the error message starts with
     `INVALID_ARGUMENT`.
   - The store stamps delegated entries with `by: participantId`, `byName: displayName` (trimmed;
     the key is omitted when there is no name) and `at` = now. Caller-supplied `by`/`at` are
     ignored, as in rule 1.
   - Latest-wins is keyed on the stamped `by`: grades per (`by`, `optionId`), rankings per
     (`by`, `round`). A delegated grade never replaces the owner's own grade, and two delegates
     never replace each other.
   - In password-protected projects delegated entries are encrypted exactly like the owner's own.
     A store may keep the key derived by a successful `openProject` with the password in memory for
     the rest of the session, so that `append` can encrypt and `openProject`/`watch` work without
     the password again; it must never persist that key, and it must refuse to write into a
     protected project for which it holds no key rather than write plaintext.

## Contract test kit

`runProjectStoreContractTests(factory)` runs against an in-memory fake Google backend and
covers:
- append-only behavior;
- latest-wins rules;
- author stamping;
- access-level enforcement;
- password round-trip, and unreadability without the password;
- `deleteProject` by the owner makes `openProject` fail with "unavailable" for everyone, and a
  non-owner calling it gets `PERMISSION_DENIED`;
- queue behavior under simulated 429s;
- delegated append (v1.2.0): delegated grades kept next to the owner's and each other's with
  `byName`, latest-wins per delegate for grades and rankings (per round), `PERMISSION_DENIED` for a
  non-owner and for delegated `outcome`/`contribution` entries (nothing written),
  `INVALID_ARGUMENT` for malformed delegates, and a delegated comment round-tripping through a
  password-protected project.

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.2.0 (unreleased) | 2026-10-06 | Add delegated append: `append(ref, entries, { onBehalfOf })` lets the owner record grades, comments and rankings for another participant (live-session guests, moved projects); new optional `byName` on grades, comments and rankings; latest-wins keyed on the stamped author (rule 6) |
| 1.1.0 (unreleased) | 2026-10-05 | Add `deleteProject` (owner only, moves Sheet to Drive trash) and `forgetProject` (participant, clears local data and listing) per constitution Principle V and FR-025 |
| 1.0.0 | 2026-10-05 | Initial project store contract |

