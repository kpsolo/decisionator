import { createRng } from "@decisionator/core";
import { runStrategyContractTests } from "@decisionator/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { randomStrategy } from "../src/index.js";

describe("Uniform Random Strategy Contract Compliance (T090, T092)", () => {
  const sampleInput = {
    options: [
      { id: "opt-1", title: "Option 1" },
      { id: "opt-2", title: "Option 2" },
      { id: "opt-3", title: "Option 3" },
    ],
    settings: {},
  };

  runStrategyContractTests(randomStrategy, {
    minOptions: 2,
    sampleInput,
  });

  it("produces deterministic permutation from seed", () => {
    const seed = "000102030405060708090a0b0c0d0e0f";
    const run1 = randomStrategy.decide(sampleInput, createRng(seed)) as unknown as {
      chosen: string[];
      order: { optionId: string }[];
      explanation: string;
    };
    const run2 = randomStrategy.decide(sampleInput, createRng(seed)) as unknown as {
      chosen: string[];
      order: { optionId: string }[];
      explanation: string;
    };

    expect(run1.chosen).toEqual(run2.chosen);
    expect(run1.order).toEqual(run2.order);
    expect(run1.explanation).toContain("Uniform random draw");
  });

  it("checks minOptions < 2 fails", () => {
    expect(randomStrategy.check({ options: [{ id: "opt-1", title: "1" }], settings: {} }).ok).toBe(
      false
    );
  });
});
