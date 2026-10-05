# Contract: Project Store — v1.1.0

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
  append(ref: ProjectRef, entries: Entry[]): Promise<AppendResult>;    // grades, comments, rankings, outcomes
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
  | { kind: "outcome"; outcome: OutcomeRecord };
```

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
- queue behavior under simulated 429s.

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.1.0 (unreleased) | 2026-10-05 | Add `deleteProject` (owner only, moves Sheet to Drive trash) and `forgetProject` (participant, clears local data and listing) per constitution Principle V and FR-025 |
| 1.0.0 | 2026-10-05 | Initial project store contract |

