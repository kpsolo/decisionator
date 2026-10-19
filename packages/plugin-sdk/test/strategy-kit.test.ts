import { describe, expect, it } from "vitest";
import type { StrategyInput, StrategyPlugin } from "../src/strategy.js";
import {
  RNG_TEST_VECTORS,
  assertNoAmbientRandomness,
  assertRngMatchesVectors,
  runStrategyContractTests,
} from "../testing/strategy-kit.js";

const input: StrategyInput = {
  options: [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ],
  settings: {},
};

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

  it("accepts a strategy that only uses the host Rng", () => {
    expect(() => assertNoAmbientRandomness(dummyStrategy, input)).not.toThrow();
  });

  it("fails if Math.random is called during decide", () => {
    const leakyStrategy: StrategyPlugin = {
      check: () => ({ ok: true }),
      decide(input) {
        Math.random();
        const first = input.options[0];
        return { chosen: first ? [first.id] : [], explanation: "" };
      },
    };
    expect(() => assertNoAmbientRandomness(leakyStrategy, input)).toThrow(/Math\.random/);
  });

  it("fails if crypto.getRandomValues is called during decide, even when the error is swallowed", () => {
    const sneakyStrategy: StrategyPlugin = {
      check: () => ({ ok: true }),
      decide(input) {
        try {
          crypto.getRandomValues(new Uint8Array(4));
        } catch {
          // swallowed on purpose
        }
        const first = input.options[0];
        return { chosen: first ? [first.id] : [], explanation: "" };
      },
    };
    expect(() => assertNoAmbientRandomness(sneakyStrategy, input)).toThrow(/getRandomValues/);
  });

  it("restores Math.random and crypto.getRandomValues afterwards", () => {
    const random = Math.random;
    const grv = crypto.getRandomValues;
    try {
      assertNoAmbientRandomness(dummyStrategy, input);
    } catch {
      // not expected
    }
    expect(Math.random).toBe(random);
    expect(crypto.getRandomValues).toBe(grv);
    expect(typeof Math.random()).toBe("number");
  });

  it("checks the Rng against the frozen contract vectors", () => {
    expect(RNG_TEST_VECTORS.length).toBeGreaterThan(0);
    expect(() => assertRngMatchesVectors()).not.toThrow();
    const broken = () => ({
      seed: "",
      nextUint32: () => 0,
      int: () => 0,
      float: () => 0,
    });
    expect(() => assertRngMatchesVectors(broken)).toThrow(/vector/);
  });
});
