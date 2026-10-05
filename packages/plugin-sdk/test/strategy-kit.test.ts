import { describe, expect, it, vi } from "vitest";
import type { StrategyPlugin } from "../src/strategy.js";
import { runStrategyContractTests } from "../testing/strategy-kit.js";

describe("runStrategyContractTests", () => {
  const dummyStrategy: StrategyPlugin = {
    check(input) {
      if (input.options.length < 2) {
        return { ok: false, reason: "Requires at least 2 options" };
      }
      return { ok: true };
    },
    decide(input, rng) {
      const idx = rng.int(input.options.length);
      const opt = input.options[idx] ?? input.options[0];
      return {
        chosen: opt ? [opt.id] : [],
        explanation: opt ? `Picked ${opt.title}` : "",
      };
    },
  };

  runStrategyContractTests(dummyStrategy, { minOptions: 2 });

  it("fails if Math.random is called during decide", () => {
    const leakyStrategy: StrategyPlugin = {
      check: () => ({ ok: true }),
      decide(input) {
        Math.random();
        const first = input.options[0];
        return { chosen: first ? [first.id] : [], explanation: "" };
      },
    };

    expect(() => {
      runStrategyContractTests(leakyStrategy, { minOptions: 1 });
    }).toBeDefined();
  });
});
