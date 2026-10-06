import { createRng } from "@decisionator/core";
import { runStrategyContractTests } from "@decisionator/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { type BordaDecideResult, bordaStrategy } from "../src/index.js";

describe("Borda Strategy Contract Compliance (T073)", () => {
  // 1. Run standard strategy contract tests
  runStrategyContractTests(bordaStrategy, { minOptions: 2 });

  const sampleOptions = [
    { id: "opt_a", title: "Option A" },
    { id: "opt_b", title: "Option B" },
    { id: "opt_c", title: "Option C" },
    { id: "opt_d", title: "Option D" },
  ];

  it("calculates Borda count points correctly: rank r on top-N earns N - r + 1, unranked earn 0", () => {
    const rng = createRng("000102030405060708090a0b0c0d0e0f");
    const input = {
      options: sampleOptions,
      settings: { topN: 3 },
      ballots: [
        { by: "alice", ranking: ["opt_a", "opt_b", "opt_c"] }, // A:3, B:2, C:1, D:0
        { by: "bob", ranking: ["opt_b", "opt_a", "opt_d"] }, // B:3, A:2, D:1, C:0
      ],
    };

    const res = bordaStrategy.decide(input, rng) as BordaDecideResult;
    expect(["opt_a", "opt_b"]).toContain(res.chosen[0]); // Both have 5 points, tie-break triggered
    const itemA = res.order.find((o) => o.optionId === "opt_a");
    const itemB = res.order.find((o) => o.optionId === "opt_b");
    const itemC = res.order.find((o) => o.optionId === "opt_c");
    const itemD = res.order.find((o) => o.optionId === "opt_d");

    expect(itemA?.points).toBe(5);
    expect(itemB?.points).toBe(5);
    expect(itemC?.points).toBe(1);
    expect(itemD?.points).toBe(1);
  });

  it("supports partial ballots gracefully", () => {
    const rng = createRng("000102030405060708090a0b0c0d0e0f");
    const input = {
      options: sampleOptions,
      settings: { topN: 3 },
      ballots: [
        { by: "alice", ranking: ["opt_c"] }, // Only ranked 1 option: C:3
      ],
    };

    const res = bordaStrategy.decide(input, rng) as BordaDecideResult;
    expect(res.chosen).toEqual(["opt_c"]);
    const itemC = res.order.find((o) => o.optionId === "opt_c");
    expect(itemC?.points).toBe(3);
  });

  it("breaks ties with tie-break chain: higher average grade wins first", () => {
    const rng = createRng("000102030405060708090a0b0c0d0e0f");
    const input = {
      options: [
        { id: "opt_x", title: "Option X" },
        { id: "opt_y", title: "Option Y" },
      ],
      settings: { topN: 2 },
      ballots: [
        { by: "alice", ranking: ["opt_x", "opt_y"] }, // X:2, Y:1
        { by: "bob", ranking: ["opt_y", "opt_x"] }, // Y:2, X:1 -> Total X:3, Y:3
      ],
      grades: [
        { optionId: "opt_x", average: 4.5, count: 2 },
        { optionId: "opt_y", average: 3.8, count: 2 },
      ],
    };

    const res = bordaStrategy.decide(input, rng) as BordaDecideResult;
    expect(res.chosen).toEqual(["opt_x"]);
    expect(res.tieBreak).toBe("average-grade");
    expect(res.seedUsed).toBeUndefined(); // seed not recorded when grade tie-break succeeds
  });

  it("breaks ties with tie-break chain: more first places wins if grades are tied", () => {
    const rng = createRng("000102030405060708090a0b0c0d0e0f");
    const input = {
      options: [
        { id: "opt_x", title: "Option X" },
        { id: "opt_y", title: "Option Y" },
        { id: "opt_z", title: "Option Z" },
      ],
      settings: { topN: 3 },
      ballots: [
        { by: "alice", ranking: ["opt_x", "opt_z", "opt_y"] }, // X:3, Z:2, Y:1
        { by: "bob", ranking: ["opt_y", "opt_x", "opt_z"] }, // Y:3, X:2, Z:1
        { by: "carol", ranking: ["opt_y", "opt_z", "opt_x"] }, // Y:3, Z:2, X:1
        // Points: X: 3+2+1 = 6; Y: 1+3+3 = 7;
      ],
      grades: [
        { optionId: "opt_x", average: 4.0, count: 3 },
        { optionId: "opt_y", average: 4.0, count: 3 },
      ],
    };

    const res = bordaStrategy.decide(input, rng) as BordaDecideResult;
    expect(res.chosen).toEqual(["opt_y"]);
  });

  it("breaks ties with seeded random draw and records seed only when needed", () => {
    const testSeed = "000102030405060708090a0b0c0d0e0f";
    const rng = createRng(testSeed);
    const input = {
      options: [
        { id: "opt_m", title: "Option M" },
        { id: "opt_n", title: "Option N" },
      ],
      settings: { topN: 2 },
      ballots: [
        { by: "alice", ranking: ["opt_m", "opt_n"] }, // M:2, N:1
        { by: "bob", ranking: ["opt_n", "opt_m"] }, // N:2, M:1
      ],
      // No grades provided -> completely tied
    };

    const res = bordaStrategy.decide(input, rng) as BordaDecideResult;
    expect(res.tieBreak).toBe("seeded-random");
    expect(res.seedUsed).toBe(testSeed);
  });

  it("satisfies SC-006 determinism over 100 runs", () => {
    const seed = "11223344556677889900aabbccddeeff";
    const input = {
      options: sampleOptions,
      settings: { topN: 3 },
      ballots: [
        { by: "u1", ranking: ["opt_a", "opt_b"] },
        { by: "u2", ranking: ["opt_c", "opt_d"] },
      ],
    };

    const firstResult = bordaStrategy.decide(input, createRng(seed));

    for (let i = 0; i < 100; i++) {
      const runResult = bordaStrategy.decide(input, createRng(seed));
      expect(runResult.chosen).toEqual(firstResult.chosen);
      expect(runResult.explanation).toEqual(firstResult.explanation);
    }
  });
});
