import { createRng } from "@decisionator/core";
import { describe, expect, it } from "vitest";
import type { Rng, StrategyInput, StrategyPlugin } from "../src/strategy.js";
import vectors from "./vectors.json";

export interface StrategyTestFixtures {
  minOptions?: number;
  sampleInput?: StrategyInput;
}

/** One frozen Rng test vector from contracts/strategy.md (`testing/vectors.json`). */
export interface RngTestVector {
  seed: string;
  calls: { method: "nextUint32" | "int" | "float"; arg?: number; expected: number }[];
}

export const RNG_TEST_VECTORS: readonly RngTestVector[] = vectors as RngTestVector[];

/**
 * Replays the frozen contract vectors against an Rng factory (the host's `createRng` by
 * default). Throws on the first mismatch.
 */
export function assertRngMatchesVectors(makeRng: (seed: string) => Rng = createRng): void {
  RNG_TEST_VECTORS.forEach((vector, v) => {
    const rng = makeRng(vector.seed);
    vector.calls.forEach((call, c) => {
      const actual =
        call.method === "int"
          ? rng.int(call.arg ?? 0)
          : call.method === "float"
            ? rng.float()
            : rng.nextUint32();
      if (actual !== call.expected) {
        throw new Error(
          `Rng test vector ${v} (seed ${vector.seed}), call ${c} ${call.method}(${call.arg ?? ""}): expected ${call.expected}, got ${actual}`
        );
      }
    });
  });
}

/**
 * Runs `decide` with Math.random and crypto.getRandomValues replaced by traps. Throws if either
 * was touched, even when the strategy caught the trap's error. Both are restored afterwards.
 */
export function assertNoAmbientRandomness(
  plugin: StrategyPlugin,
  input: StrategyInput,
  seed = "1234567890abcdef1234567890abcdef"
): void {
  const used: string[] = [];
  const originalRandom = Math.random;
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  const hadOwnGetRandomValues =
    cryptoObj !== undefined && Object.hasOwn(cryptoObj, "getRandomValues");
  const ownGetRandomValues = hadOwnGetRandomValues ? cryptoObj?.getRandomValues : undefined;

  Math.random = () => {
    used.push("Math.random");
    throw new Error("Contract violation: Math.random called inside strategy decide()");
  };
  if (cryptoObj) {
    Object.defineProperty(cryptoObj, "getRandomValues", {
      configurable: true,
      writable: true,
      value: () => {
        used.push("crypto.getRandomValues");
        throw new Error(
          "Contract violation: crypto.getRandomValues called inside strategy decide()"
        );
      },
    });
  }

  let decideError: unknown;
  try {
    plugin.decide(input, createRng(seed));
  } catch (err) {
    decideError = err;
  } finally {
    Math.random = originalRandom;
    if (cryptoObj) {
      if (hadOwnGetRandomValues) {
        Object.defineProperty(cryptoObj, "getRandomValues", {
          configurable: true,
          writable: true,
          value: ownGetRandomValues,
        });
      } else {
        // Drop the own trap so the prototype method shows through again.
        Reflect.deleteProperty(cryptoObj, "getRandomValues");
      }
    }
  }

  if (used.length > 0) {
    throw new Error(
      `Contract violation: strategy decide() used ambient randomness (${[...new Set(used)].join(", ")}); use the host Rng instead`
    );
  }
  if (decideError !== undefined) throw decideError;
}

/**
 * Executes standard contract tests for a StrategyPlugin:
 * - The host Rng reproduces the frozen contract test vectors
 * - Determinism over 100 runs with the same seed
 * - chosen ⊆ options
 * - check rejects inputs below minOptions
 * - Math.random / crypto.getRandomValues are never used by decide
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
    it("runs on an Rng that reproduces the contract test vectors", () => {
      assertRngMatchesVectors();
    });

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
      assertNoAmbientRandomness(plugin, defaultInput);
    });
  });
}
