# Contract: Project Store — v1.4.0

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
  share(ref: ProjectRef, req: ShareRequest): Promise<ShareState>;      // owner only; link on/off + role, invite/remove email (FR-015, FR-018)
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
  | { kind: "contribution"; contribution: Contribution }
  | {                                                            // v1.4.0: option property value
      kind: "property";
      optionId: string;
      plugin: string;                                            // id of the declaring plugin
      key: string;                                               // /^[a-z][a-z0-9_]{0,39}$/
      scope: "shared" | "person";
      value: string | number | boolean | null;                   // null clears the value
    }
  | {                                                            // v1.4.0: reset (history-resets)
      kind: "reset";
      scope: "all" | "participant";
      participantId?: string;                                    // required for "participant", forbidden for "all"
      targets: ("grades" | "ballots" | "properties")[];          // 1–3, unique
      round?: number;                                            // int ≥ 1; limits "ballots" to that round
      plugin?: string;                                           // limits "properties"; both or neither
      key?: string;
    };

type MetaPatch = Partial<Pick<Project, "title" | "description" | "voting">> & {
  strategy?: { id: string; version: string; settings: Record<string, unknown> }; // v1.4.0, owner only
};

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

A stored record that fails validation (e.g. after a direct edit of the backing file) is left out
of the snapshot instead of failing `openProject`. Since v1.3.0 the store reports each one in the
optional `ProjectSnapshot.warnings: string[]`, naming where it is stored and why it was skipped
(Google Sheets: `"<tab> row <n>: <reason>"`). The field is absent when nothing was skipped, and the
UI shows it to the user.

Since v1.4.0 `ProjectSnapshot` also carries `properties?: PropertyValue[]` (`@decisionator/core`):
the effective option property values, each `{ id, at, by, byName?, optionId, plugin, key, scope,
value }`. See [option-properties.md](../../005-option-status-properties/contracts/option-properties.md).

Since v1.4.0 `ProjectSnapshot` also carries `history?: { grades, rankings, properties, resets }`:
the superseded and cleared entries and every reset, oldest first (rule 9), and
`snapshot.project` carries the optional `strategy` (`{ id, version, settings, at, by }`) and
`strategyChanges` (`{ id, at, by }[]`, at most 20, newest last) (rule 10). See
[history-resets.md](../../005-option-status-properties/contracts/history-resets.md) and
[strategy-choice.md](../../005-option-status-properties/contracts/strategy-choice.md).

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
7. **Sharing is owner-only (v1.2.1).** Only the project **owner** may call `share`. Any other
   participant, whatever their role, gets an error whose message starts with `PERMISSION_DENIED`,
   and nothing is changed. `inviteUsers` adds a collaborator or changes their role;
   `removeUsers` revokes the named collaborators. Removing an email that is not a collaborator,
   or the owner's own email, is a no-op. A store that cannot revoke an individual (for example
   Google while link sharing stays on, research R21) throws `NOT_SUPPORTED` before changing
   anything (rule 3).
8. **Option properties (v1.4.0).** Plugins declare option properties; their values are stored as
   `property` entries.
   1. `append(ref, [{ kind: "property", optionId, plugin, key, scope, value }])` records a value.
      The store stamps `id`, `at` and `by`, and keeps `byName` as for grades.
   2. Stores check shape only: the field types above, a JSON-serialized `value` of at most 2 KiB,
      and an existing `optionId`. Otherwise the error message starts with `INVALID_ARGUMENT`.
      Type checks against plugin declarations happen in the host (`checkPropertyValue`), because
      stores do not know the plugins. The plugin SDK exports `checkPropertyEntries` and
      `propertyRecord` for store authors.
   3. Latest wins: per (`plugin`, `key`, `optionId`) for `shared`, per (`by`, `plugin`, `key`,
      `optionId`) for `person` (`propertySlot` in `@decisionator/core`). `value: null` stays as the
      newest entry and clears the value.
   4. `shared` values may be appended only by the owner. A non-owner append of `shared` is refused
      with `PERMISSION_DENIED`.
   5. `onBehalfOf` is allowed for `property` only with `scope: "person"`. Otherwise the call is
      refused with `PERMISSION_DENIED`.
   6. `openProject` returns `properties: PropertyValue[]`, effective values only. Values of
      plugins the host does not know are returned unchanged.
   7. Password-protected projects store `value` encrypted, as they do for comment bodies.

   As for delegation, the store validates the whole call before writing: a rejected call writes
   nothing.
9. **History and resets (v1.4.0).**
   1. Append, never replace: stores keep every `grade`, `ranking`, `property` and `reset` entry,
      in append order. Latest-wins (rules 6 and 8.3) and resets are applied when the snapshot is
      built, with `effectiveEntries` from `@decisionator/core`. Stores stamp `at` with
      `monotonicNow()` (strictly increasing), so "appended after" is decidable by time.
   2. `snapshot.grades`, `rankings` and `properties` keep their meaning: effective entries only.
      A cleared slot is absent; a reset never writes `null`.
   3. `snapshot.history` holds the superseded and cleared grades, rankings and properties and
      every reset, oldest first.
   4. An earlier entry E is cleared by a reset R when R was appended after E; E's kind
      (`grade` → `grades`, `ranking` → `ballots`, `property` → `properties`) is in `R.targets`;
      `R.scope` is `all` or `E.by === R.participantId`; with `R.round`, E is a ballot of that
      round (grades are not round-scoped); with `R.plugin`/`R.key`, E is a property with that
      plugin and key. An `all` reset clears only `shared` property values; per-person values are
      cleared only by participant resets.
   5. Permissions: the owner may append any reset. Anyone else, including through `onBehalfOf`,
      may append only `{ scope: "participant", participantId: <self or delegate>,
      targets: ["properties"], plugin, key }`. Anything else is refused with
      `PERMISSION_DENIED`, and nothing from the call is written. Stores call
      `checkResetEntries(entries, { isOwner, self })` from the plugin SDK: for a delegated call
      with `isOwner: false` and `self` = the delegate's `participantId`.
   6. Validation: `targets` that are not 1–3 unique values, `participantId` given for `all` or
      missing for `participant`, only one of `plugin` and `key`, or `round` < 1 are refused with
      `INVALID_ARGUMENT`, and nothing is written.
   7. The store stamps `id`, `at`, `by` and `byName` as for grades (`resetRecord` in the plugin
      SDK). Reset records hold no secrets and may be stored in plaintext in password mode;
      property values and comment bodies in the history stay encrypted as in rule 8.7.
   8. Outcomes are never affected: recorded outcomes keep their inputs and still verify.
10. **Strategy choice (v1.4.0).** `updateMeta(ref, { strategy: { id, version, settings } })`
    stores the project's decision strategy.
    1. Owner only; anyone else gets `PERMISSION_DENIED` (as for every `updateMeta`).
    2. The store stamps `at` and `by` and appends `{ id, at, by }` to `strategyChanges`, keeping
       the last 20 (`applyStrategyPatch` in the plugin SDK).
    3. `openProject` returns `project.strategy` and `project.strategyChanges`. Both are absent for
       older projects; the host then uses Borda count with `{ topN: voting.topN }`.
    4. Password-protected projects store the strategy `settings` encrypted, like the title.

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
  password-protected project;
- sharing (v1.2.1): a non-owner (`view` or `contribute`) calling `share` to invite, change a role,
  remove a collaborator or toggle link sharing gets `PERMISSION_DENIED` and changes nothing, and
  the owner's `removeUsers` revokes only the named collaborators;
- option properties (v1.4.0): latest-wins per slot for `shared` and `person` values, `null`
  clearing a value, delegated `person` values under the delegate's id with `byName`,
  `PERMISSION_DENIED` for delegated or non-owner `shared` values, `INVALID_ARGUMENT` for
  malformed entries, unknown options and values over 2 KiB (nothing written), values of unknown
  plugins returned unchanged, and a round trip through a password-protected project;
- history and resets (v1.4.0): a re-grade kept in `history.grades`; a participant reset clearing
  only that participant (entries appended after it count again); an `all` reset with `round: 1`
  clearing grades and round-1 ballots but not round-2 ballots or outcomes; a collaborator's self
  reset accepted and resets of others or of votes refused with `PERMISSION_DENIED`; a delegated
  self reset accepted; an invalid reset refused with `INVALID_ARGUMENT` (nothing written); and
  history and resets surviving a password-protected round trip;
- strategy meta (v1.4.0): the strategy round-trips with `by` and `at`, `strategyChanges` keeps
  at most 20 entries, a non-owner change gets `PERMISSION_DENIED`, and the strategy round-trips
  through a password-protected project.

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.4.0 (unreleased) | 2026-10-07 | Add the `property` entry kind and `ProjectSnapshot.properties`: plugin-declared option property values, `shared` (owner only) or `person` (per participant), latest-wins per slot, `null` clears, delegation only for `person`, encrypted in password mode (rule 8). Add the `reset` entry kind and `ProjectSnapshot.history`: stores append every grade, ranking, property and reset and build the snapshot with `effectiveEntries`; owner-only resets except a self `properties` reset (rule 9). Add `MetaPatch.strategy` and `Project.strategy`/`strategyChanges` (owner only, last 20 changes, settings encrypted in password mode; rule 10). Contract kit covers rules 8.1–8.6, 9 and 10 |
| 1.3.0 (unreleased) | 2026-10-06 | Add optional `ProjectSnapshot.warnings`: records skipped because they failed validation, so the UI can name them |
| 1.2.1 (unreleased) | 2026-10-06 | `share` is owner-only: non-owners get `PERMISSION_DENIED` (rule 7). `removeUsers` must revoke the named collaborators; Google refuses it with `NOT_SUPPORTED` while link sharing stays on. Contract kit covers both |
| 1.2.0 (unreleased) | 2026-10-06 | Add delegated append: `append(ref, entries, { onBehalfOf })` lets the owner record grades, comments and rankings for another participant (live-session guests, moved projects); new optional `byName` on grades, comments and rankings; latest-wins keyed on the stamped author (rule 6) |
| 1.1.0 (unreleased) | 2026-10-05 | Add `deleteProject` (owner only, moves Sheet to Drive trash) and `forgetProject` (participant, clears local data and listing) per constitution Principle V and FR-025 |
| 1.0.0 | 2026-10-05 | Initial project store contract |

