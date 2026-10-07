# Contract: Project Strategy Choice and Comparison — v1.0.0

## Stored choice (ProjectStore 1.4.0 meta)

- `MetaPatch.strategy = { id, version, settings }`, owner only (otherwise `PERMISSION_DENIED`).
- The store stamps `at` and `by` and appends `{ id, at, by }` to `strategyChanges`, keeping the
  last 20.
- `snapshot.project.strategy` is absent for older projects. The app then uses Borda count with
  `{ topN: voting.topN }`.

## Host behaviour

| Action | Rule |
|---|---|
| Choose | Voting settings list the installed, enabled strategies with their settings forms. A change while voting is open and ballots exist first shows: "{n} people have already voted. Changing the method now may change the result." |
| Show | "Decided by: {name}" with its one-line description on the vote page, the live guest view and Results. |
| Close and tally | `runTally` with the chosen strategy and settings. When it is missing or disabled: "{name} is not available. Choose another method before closing the vote." When `check()` fails: its reason. In both cases voting stays open. |
| Compare | `compareStrategies` runs every enabled strategy on the same snapshot, with a seed derived from the inputs. Nothing is recorded. Each row shows the winner and the order, or why it cannot run. Rows whose winner differs from the chosen strategy's winner are marked with the text "Winner differs from the chosen method". |
| Adopt | Appends an `outcome` reproduced from the compared run (same strategy, settings and seed). The chosen strategy is left unchanged. |
| Who sees Compare | The owner always. Others read-only (no Adopt) when `voting.liveResults` is on or voting is closed. |
