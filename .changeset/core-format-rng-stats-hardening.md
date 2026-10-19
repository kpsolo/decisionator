---
"@decisionator/core": patch
"@decisionator/plugin-sdk": patch
"@decisionator/web": patch
---

Correctness fixes in core, the strategy test kit and strategy comparison.

- **Extraction:** fenced code blocks must open and close on their own lines, so a ``` inside a JSON string no longer cuts the block. The balanced `{…}`/`[…]` fallback tries every candidate in order and keeps the first that parses as an options payload (text such as `the options [as requested]: {…}` now yields the object).
- **Validation:** a title that is empty after removing citation markers is an error; `format` other than `decisionator.options/v1` is an error (a missing `format` is a warning); `pros`/`cons` items are truncated to 300 chars, link titles to 200; links must be absolute `http:`/`https:` URLs. Every validated option now parses with `OptionSchema`.
- **Rng:** `createRng` requires a 32-hex-char seed and throws a clear error otherwise (non-hex seeds used to collapse to zero bytes).
- **Stats / tally:** `computeOptionStats` keeps the exact average (display code rounds it), so strategies no longer see 4.24 and 4.16 as a tie. `runTally` seeds only from `crypto.getRandomValues` and throws when no CSPRNG exists, instead of falling back to `Math.random`.
- **Outcomes:** `OutcomeOrderItemSchema` keeps the weighted strategy's optional `weight`.
- **Strategy test kit:** the ambient-randomness check is exported as `assertNoAmbientRandomness` and also catches swallowed calls; `assertRngMatchesVectors` replays the frozen `vectors.json` and runs in every contract suite.
- **Compare strategies:** previews still use the input-derived seed, but adopting a row re-runs the strategy with a fresh CSPRNG seed before recording it.
