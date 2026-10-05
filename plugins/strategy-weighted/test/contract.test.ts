import { createRng } from "@decisionator/core";
import { runStrategyContractTests } from "@decisionator/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { weightedStrategy } from "../src/index.js";

describe("Weighted Random Strategy Contract Compliance (T090, T093)", () => {
  const sampleInput = {
    options: [
      { id: "opt-1", title: "Option 1" },
      { id: "opt-2", title: "Option 2" },
      { id: "opt-3", title: "Option 3" },
    ],
    grades: [
      { optionId: "opt-1", average: 5.0, count: 2 },
      { optionId: "opt-2", average: 2.5, count: 1 },
      // opt-3 is ungraded
    ],
    settings: { includeUngraded: false },
  };

  runStrategyContractTests(weightedStrategy, {
    minOptions: 2,
    sampleInput,
  });

  it("excludes ungraded options when includeUngraded is false", () => {
    // Over multiple seeds, opt-3 should never be chosen
    for (let i = 0; i < 50; i++) {
      const seed = `000000000000000000000000000000${i.toString(16).padStart(2, "0")}`;
      const res = weightedStrategy.decide(sampleInput, createRng(seed));
      expect(res.chosen).not.toContain("opt-3");
    }
  });

  it("includes ungraded options when includeUngraded is true", () => {
    const inputWithUngraded = {
      ...sampleInput,
      settings: { includeUngraded: true },
    };
    const res = weightedStrategy.decide(
      inputWithUngraded,
      createRng("000102030405060708090a0b0c0d0e0f")
    ) as unknown as { chosen: string[]; order: { optionId: string; weight: number }[] };
    expect(res.chosen.length).toBe(1);
    expect(res.order.find((o) => o.optionId === "opt-3")?.weight).toBe(1.0);
  });

  it("verifies frequency distribution is within tolerance over 10 000 seeds (US4, T090)", () => {
    // Options: opt-A weight 4.0, opt-B weight 1.0 -> theoretical ratio 4:1 (80% vs 20%)
    const testInput = {
      options: [
        { id: "opt-a", title: "Option A" },
        { id: "opt-b", title: "Option B" },
      ],
      grades: [
        { optionId: "opt-a", average: 4.0, count: 3 },
        { optionId: "opt-b", average: 1.0, count: 3 },
      ],
      settings: {},
    };

    let winsA = 0;
    const trials = 10_000;

    for (let i = 0; i < trials; i++) {
      const seed = `1234567890abcdef12345678${i.toString(16).padStart(8, "0")}`;
      const res = weightedStrategy.decide(testInput, createRng(seed));
      if (res.chosen[0] === "opt-a") {
        winsA++;
      }
    }

    const ratioA = winsA / trials;
    // Expected: 0.80. Tolerance ± 0.03 (0.77 to 0.83)
    expect(ratioA).toBeGreaterThanOrEqual(0.77);
    expect(ratioA).toBeLessThanOrEqual(0.83);
  });
});
