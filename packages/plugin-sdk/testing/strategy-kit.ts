import { createRng } from "@decisionator/core";
import { describe, expect, it, vi } from "vitest";
import type { StrategyInput, StrategyPlugin } from "../src/strategy.js";

export interface StrategyTestFixtures {
  minOptions?: number;
  sampleInput?: StrategyInput;
}

/**
 * Executes standard contract tests for a StrategyPlugin:
 * - Determinism over 100 runs with the same seed
 * - chosen ⊆ options
 * - check rejects inputs below minOptions
 * - Math.random / crypto.getRandomValues stubs throw
 */
export function runStrategyContractTests(
  plugin: StrategyPlugin,
  fixtures: StrategyTestFixtures = {}
): void {
  const minOptions = fixtures.minOptions ?? 2;

  const defaultInput: StrategyInput = fixtures.sampleInput ?? {
    options: [
      { id: "opt-1", title: "Option 1" },
      { id: "opt-2", title: "Option 2" },
      { id: "opt-3", title: "Option 3" },
    ],
    settings: {},
  };

  describe(`Strategy Contract: ${plugin.constructor?.name ?? "Plugin"}`, () => {
    it("is deterministic over 100 runs with the exact same seed", () => {
      const seed = "000102030405060708090a0b0c0d0e0f";
      const firstRun = plugin.decide(defaultInput, createRng(seed));

      for (let i = 0; i < 99; i++) {
        const nextRun = plugin.decide(defaultInput, createRng(seed));
        expect(nextRun.chosen).toEqual(firstRun.chosen);
        expect(nextRun.explanation).toEqual(firstRun.explanation);
      }
    });

    it("ensures chosen options are a non-empty subset of input.options", () => {
      const seed = "abcdef0123456789abcdef0123456789";
      const result = plugin.decide(defaultInput, createRng(seed));

      expect(result.chosen.length).toBeGreaterThanOrEqual(1);
      const validOptionIds = new Set(defaultInput.options.map((o) => o.id));
      for (const id of result.chosen) {
        expect(validOptionIds.has(id)).toBe(true);
      }
    });

    if (minOptions > 0) {
      it(`rejects inputs below minOptions (${minOptions})`, () => {
        const tooFewOptions: StrategyInput = {
          ...defaultInput,
          options: defaultInput.options.slice(0, Math.max(0, minOptions - 1)),
        };

        const checkRes = plugin.check(tooFewOptions);
        expect(checkRes.ok).toBe(false);
        if (!checkRes.ok) {
          expect(typeof checkRes.reason).toBe("string");
          expect(checkRes.reason.length).toBeGreaterThan(0);
        }
      });
    }

    it("throws if ambient randomness (Math.random or crypto.getRandomValues) is accessed during decide", () => {
      const originalRandom = Math.random;
      const originalGetRandomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);

      let ambientCalled = false;
      Math.random = () => {
        ambientCalled = true;
        throw new Error("Contract violation: Math.random called inside strategy decide()");
      };

      if (globalThis.crypto) {
        globalThis.crypto.getRandomValues = () => {
          ambientCalled = true;
          throw new Error(
            "Contract violation: crypto.getRandomValues called inside strategy decide()"
          );
        };
      }

      try {
        const seed = "1234567890abcdef1234567890abcdef";
        plugin.decide(defaultInput, createRng(seed));
        expect(ambientCalled).toBe(false);
      } finally {
        Math.random = originalRandom;
        if (globalThis.crypto && originalGetRandomValues) {
          globalThis.crypto.getRandomValues = originalGetRandomValues;
        }
      }
    });
  });
}
