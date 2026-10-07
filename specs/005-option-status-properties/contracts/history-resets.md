# Contract: History and Resets — part of ProjectStore 1.4.0 (unreleased, ships with 005)

These are additions to `specs/001-decision-engine-core/contracts/project-store.md` v1.4.0. Shapes
are in [data-model.md](../data-model.md), section "Extension for User Stories 5–8".

## Rules

1. **Append, never replace.** Stores keep every `grade`, `ranking`, `property` and `reset` entry.
   Latest-wins and resets are applied when building the snapshot, with `effectiveEntries` from
   `@decisionator/core`.
2. **Effective arrays keep their meaning.** `snapshot.grades`, `rankings` and `properties` hold
   effective entries only. A cleared slot is absent; a reset never writes `null`.
3. **History.** `snapshot.history` holds the superseded and cleared entries and every reset,
   oldest first.
4. **Reset permissions.**
   - The owner may append any reset.
   - Anyone else, including through `onBehalfOf`, may append only
     `{ scope: "participant", participantId: <self or delegate>, targets: ["properties"], plugin, key }`.
   - Anything else → `PERMISSION_DENIED`, and nothing from the call is written.
5. **Reset validation.** Each of these is refused with `INVALID_ARGUMENT`, and nothing is
   written:
   - `targets` that are not 1–3 unique values;
   - `participantId` given for `all`, or missing for `participant`;
   - only one of `plugin` and `key`;
   - `round` < 1.
6. **Outcomes are never affected.** Recorded outcomes keep their inputs and still verify.

## Google Sheets (layout 2.3.0, same migration step as `properties`)

- Tab `resets[id,at,by,payload]`, with `payload` = `{scope,participantId?,targets,round?,plugin?,key?,byName?}`
  (encrypted in password mode).
- Meta keys `strategy` and `strategyChanges` (JSON; encrypted in password mode like the title).

## Live share (live-share 3.0.0, unreleased)

- **Guest entry**: `{ kind: "reset", scope: "participant", targets: ["properties"], plugin, key }`.
  The host sets `participantId` to the guest.
- **Redaction of `history` for a guest**:
  - grades, rankings and properties: the guest's own only;
  - resets: those with `scope: "all"` or that target the guest.

## Export

- `ProjectExportV1` gains optional `history` and `resets`, both defaulting to empty.
- XLSX gains a "History" sheet (Kind, Option, Value, By, By name, At, Record (JSON)) and a
  "Resets" sheet.
- **Restore** re-appends the history in its original order, then the effective entries and
  resets, so the history survives. Times become the restore time; the original times stay in
  the file.

## Contract-kit cases

- A re-grade keeps the earlier grade in `history.grades`.
- A participant reset clears only that participant.
- An all-scope reset with `round: 1` clears grades and round-1 ballots, but leaves round-2 ballots.
- A collaborator's self seen reset is accepted; a reset that targets another person is refused.
- A delegated self reset is accepted.
- An invalid reset is refused and writes nothing.
- Outcomes are unchanged after a reset.
- Strategy meta round-trips, `strategyChanges` keeps at most 20 entries, and a non-owner change is
  refused.
