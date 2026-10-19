import { createRng } from "@decisionator/core";
import { describe, expect, it } from "vitest";
import { type BordaDecideResult, bordaStrategy } from "../src/index.js";

const seedOf = (i: number) => i.toString(16).padStart(32, "0");

/** Every option gets the same points, grade and first places: a full tie. */
function fullTie(n: number) {
  const options = Array.from({ length: n }, (_, i) => ({ id: `o${i}`, title: `O${i}` }));
  return { options, settings: { topN: 3 }, ballots: [] };
}

function winnerShares(n: number, runs: number): number[] {
  const input = fullTie(n);
  const wins = new Array<number>(n).fill(0);
  for (let i = 0; i < runs; i++) {
    const res = bordaStrategy.decide(input, createRng(seedOf(i)));
    const idx = Number(res.chosen[0]?.slice(1));
    wins[idx] = (wins[idx] ?? 0) + 1;
  }
  return wins.map((w) => w / runs);
}

describe("Borda seeded-random tie-break", () => {
  it("draws the winner of a 3-way tie uniformly (±2%)", () => {
    for (const share of winnerShares(3, 20_000)) {
      expect(Math.abs(share - 1 / 3)).toBeLessThan(0.02);
    }
  });

  it("draws the winner of a 4-way tie uniformly (±2%)", () => {
    for (const share of winnerShares(4, 20_000)) {
      expect(Math.abs(share - 1 / 4)).toBeLessThan(0.02);
    }
  });

  it("reports tieBreak 'none' when the winner is unique, even if lower places tie", () => {
    const seed = seedOf(7);
    const res = bordaStrategy.decide(
      {
        options: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
          { id: "c", title: "C" },
        ],
        settings: { topN: 1 },
        ballots: [{ by: "u1", ranking: ["a"] }], // a:1, b:0, c:0 (b and c fully tied)
      },
      createRng(seed)
    ) as BordaDecideResult;
    expect(res.chosen).toEqual(["a"]);
    expect(res.tieBreak).toBe("none");
    // The lower tie was drawn with the seed, so it must be recorded to reproduce the order.
    expect(res.seedUsed).toBe(seed);
  });

  it("reports how first and second place were separated", () => {
    const res = bordaStrategy.decide(
      {
        options: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
          { id: "c", title: "C" },
          { id: "d", title: "D" },
        ],
        settings: { topN: 1 },
        ballots: [
          { by: "u1", ranking: ["a"] },
          { by: "u2", ranking: ["b"] },
        ],
        grades: [
          { optionId: "a", average: 4.2, count: 2 },
          { optionId: "b", average: 4.1, count: 2 },
          // c and d: equal points, equal (missing) grades, equal first places
        ],
      },
      createRng(seedOf(1))
    ) as BordaDecideResult;
    expect(res.chosen).toEqual(["a"]);
    expect(res.order.map((o) => o.optionId).slice(0, 2)).toEqual(["a", "b"]);
    expect(res.tieBreak).toBe("average-grade");
  });

  it("records no seed when nothing is tied", () => {
    const res = bordaStrategy.decide(
      {
        options: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        settings: { topN: 2 },
        ballots: [{ by: "u1", ranking: ["a", "b"] }],
      },
      createRng(seedOf(3))
    ) as BordaDecideResult;
    expect(res.tieBreak).toBe("none");
    expect(res.seedUsed).toBeUndefined();
  });
});
