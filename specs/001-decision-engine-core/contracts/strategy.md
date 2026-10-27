# Contract: Decision Strategy — v1.2.0

> **Scope:** the Borda ranking strategy ships in the MVP (US3). Owner pick, random and weighted ship in US4.

Platform key: `platform.strategy`. Manifest declaration: `provides.strategy`
([plugin-manifest.schema.json](./plugin-manifest.schema.json)).
Built-ins: Borda ranking (MVP, research R25), owner pick, uniform random, weighted by average grade (FR-023, FR-030).

## Interface (TypeScript, from `@decisionator/plugin-sdk`)

```ts
interface StrategyInput {
  options: { id: string; title: string; weight?: number }[];   // active options, in display order
  ballots?: BallotSnapshot[];                                  // when manifest.ballots != "none"; ranking = { by, ranking: optionId[] }
  grades?: { optionId: string; average: number; count: number }[];  // aggregated 1–5 grades (Borda tie-break, weighted-by-grade)
  settings: unknown;                                           // validated against settingsSchema
  runInput?: unknown;                                          // when interactive, validated against runInputSchema
}

interface StrategyResult {
  chosen: string[];          // ≥ 1 option id, each present in input.options
  explanation: string;       // markdown, ≤ 4 000 chars, shown with the outcome
}

interface StrategyPlugin {
  check(input: StrategyInput): { ok: true } | { ok: false; reason: string };  // FR-032, plain language
  decide(input: StrategyInput, rng: Rng): StrategyResult;                       // pure & deterministic
}
```

RPC methods: `strategy.check`, `strategy.decide`.

## Rules

1. `decide` MUST be a pure function of `(input, rng)`: same input and same seed produce the same
   result. No clock, no network, no ambient randomness. The sandbox enforces the last one.
2. The host calls `check` before `decide`. It also checks `minOptions` / `requiresWeights` from
   the manifest. If `check` fails, no outcome is recorded and the reason is shown (US4 #4).
3. The host, not the plugin, writes the Outcome
   ([data-model.md § Outcome](../data-model.md)). It records the plugin id, version,
   packageHash, settings, the input snapshot and the seed. The seed is the draw seed below; the
   host never records a seed chosen by a caller.
4. Verification (FR-031) re-runs `decide` with the recorded snapshot and seed on the plugin
   package whose hash matches. The result must equal `chosen` exactly. If no matching package is
   installed, the result is `strategy_unavailable`.

## Rng (host-provided, deterministic)

```ts
interface Rng {
  readonly seed: string;            // 32 hex chars (128 bits)
  nextUint32(): number;
  int(maxExclusive: number): number;  // uniform in [0, maxExclusive)
  float(): number;                    // uniform in [0, 1), 53-bit
}
```

**Normative algorithm** (any language can reproduce it):

- `block(i) = SHA-256( hexDecode(seed) ‖ uint32_be(i) )` for `i = 0, 1, 2, …`
- Each 32-byte block yields eight `uint32` words, big-endian, consumed in order.
- `int(n)`: let `limit = floor(2^32 / n) * n`. Draw words until `w < limit`, then return `w mod n`.
- `float()`: `((a >>> 5) * 2^26 + (b >>> 6)) / 2^53`, where `a, b` are the next two words.

The host records the seed when the manifest has `usesRandomness: true` or the strategy reports
that it drew (Borda `seedUsed`). The seed is the draw seed below (since v1.2.0; before, a CSPRNG
seed).

## Draw seed (v1.2.0, verifiable draws)

A recorded seed is derived, never chosen, so anyone can recompute it from the outcome and the
owner cannot try seeds until a preferred option wins:

```
material = canonicalJson({
  round,                                   // outcome.round, 1 when absent
  strategy: { id, version },               // outcome.strategy
  options:  [{ id, weight? }],             // outcome.inputs.options, recorded order, no titles
  ballots:  [{ by, ranking }]?,            // outcome.inputs.ballots, recorded order
  grades:   [{ optionId, average, count }]?,
  settings?, runInput?                     // outcome.inputs.settings / runInput
})
seed = lowercaseHex( SHA-256( utf8("decisionator/draw-seed/v1") ‖ 0x00 ‖ utf8(material) ) )[0..32)
```

`canonicalJson`: object keys sorted by UTF-16 code units, members whose value is `undefined`
left out, arrays in order, no whitespace, strings and numbers as ECMAScript `JSON.stringify`
writes them; non-finite numbers are invalid. Option titles are left out because they do not
change a decision and sealed projects may store them differently. Option ids are unique per
project, so they also separate draws of different projects.

`@decisionator/core` exports `deriveDrawSeed`, `drawSeedMaterial`, `canonicalJson` and
`verifyOutcomeSeed(outcome)`, which returns `no-draw`, `verified` or `unverifiable` and never
throws. Hosts MUST show an outcome whose recorded seed does not match as
"legacy / unverifiable" (outcomes recorded before v1.2.0 carry CSPRNG seeds) rather than reject
it, and SHOULD show how many times a round was decided again ("re-decided N times";
`redecidedCount`). Re-deciding the same round with the same strategy and inputs reproduces the
same draw, so a different result requires a visible change of inputs or strategy.

Vector: for round 1, strategy `org.decisionator.strategy.random` 0.1.0, options `lis`, `bcn`,
ballot `gina: [lis, bcn]`, grade `bcn: 4.5 × 2` and settings `{}`, the seed is
`734c77096ba776675113181458a32bfd` (`packages/core/test/draw-seed.test.ts`).

### Residual trust

There is no server, so the scheme is publicly verifiable but not unpredictable:

- **Predictable before closing.** Anyone who can read the votes can compute the draw before
  voting closes. A voter, including the owner, can change their own ballot or grades (or the
  owner the options, settings or strategy) until the draw favours an option. Every such change
  is an appended entry kept in the history, and the recorded inputs are what the seed commits
  to; nothing is hidden, but nothing prevents it either.
- **Re-deciding.** The owner can record further outcomes for a round. Each is kept, the latest
  is in force, and hosts show "re-decided N times"; with unchanged inputs and strategy the draw
  repeats.
- **Recorded inputs.** `verifyOutcomeSeed` proves that the seed matches the inputs recorded in
  the outcome. Whether those inputs are the project's real votes at closing time is checked by
  comparing them with the vote history (and verification re-runs `decide`, rule 4). Whoever
  controls the store (the owner's Drive file or local file) can rewrite history itself.
- **Future.** A commit-reveal nonce (hash published when voting opens, revealed at closing, mixed
  into `material`) would remove the predictability for voters other than the owner. It needs a
  new field in the stored voting state of every store and is not part of v1.2.0.

## Reference test vectors (contract test kit)

| seed | call sequence | expected |
|------|---------------|----------|
| `000102030405060708090a0b0c0d0e0f` | `nextUint32()` ×3 | `2237479810, 1432266169, 209670291` |
| `000102030405060708090a0b0c0d0e0f` | `int(4)` ×5 | `2, 1, 3, 2, 0` |
| `ffffffffffffffffffffffffffffffff` | `int(10)` ×5 | `3, 8, 9, 1, 4` |
| `ffffffffffffffffffffffffffffffff` | `float()` ×1 | `0.060539633583655994` |

These vectors were generated from the normative algorithm above with Node's `crypto`. They are
frozen in `plugin-sdk/testing/vectors.json`.

## Contract test kit

`runStrategyContractTests(plugin, fixtures)` from `@decisionator/plugin-sdk/testing` checks:
- determinism (same seed → same result, 100 runs);
- `chosen ⊆ options`;
- `check` rejects inputs below `minOptions`;
- no ambient randomness.

For the built-in weighted strategy it also checks that weight 0 is never chosen and that the
frequency distribution is within tolerance over 10 000 seeds (US4 #3).

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.2.0 (unreleased) | 2026-10-27 | Verifiable draws: the recorded seed is derived from the round, strategy and recorded inputs (§ Draw seed) instead of a CSPRNG; callers can no longer supply a seed; `verifyOutcomeSeed`, re-decide count and the residual-trust statement (SECURITY_AUDIT F7). The Rng algorithm and its vectors are unchanged. |
| 1.1.0 (unreleased) | 2026-10-05 | Add optional `grades` aggregation to `StrategyInput` for Borda tie-breaking and weighted-by-grade strategies (FR-023, FR-030) |
| 1.0.0 | 2026-10-05 | Initial decision strategy contract |

