---
"@decisionator/strategy-borda": minor
---

Borda's seeded-random tie-break is now unbiased and engine-independent. Options are sorted by points, average grade and first places only; each group of fully tied options is then shuffled with a Fisher–Yates draw on the host Rng (previously `rng.int(2)` ran inside the sort comparator, so in a 3-way tie the winner shares were about 44/19/37 % and depended on the JS engine's sort). `tieBreak` now reports only how first and second place were separated, so a unique winner gives `"none"` even when lower places tie. `seedUsed` is set whenever any tied group was drawn, so the whole order can be replayed.

Observable change: for the same seed, outcomes with fully tied options can differ from 0.1.x. Outcomes recorded with 0.1.x that used the seeded draw may not re-verify on this version.
