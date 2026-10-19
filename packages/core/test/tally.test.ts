import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grade, Option } from "../src/index.js";
import {
  type TallyStrategyInput,
  type TallyStrategyPlugin,
  runTally,
} from "../src/strategy-host/tally.js";

const option = (id: string): Option => ({
  id,
  title: id.toUpperCase(),
  description: "",
  status: "active",
  tags: [],
  pros: [],
  cons: [],
  links: [],
});

const gradesFor = (optionId: string, values: Grade["value"][]): Grade[] =>
  values.map((value, i) => ({
    id: `${optionId}-${i}`,
    at: "2026-10-05T01:00:00Z",
    by: `voter${i}`,
    optionId,
    value,
  }));

function capturingStrategy() {
  const seen: TallyStrategyInput[] = [];
  const strategy: TallyStrategyPlugin = {
    check: () => ({ ok: true }),
    decide(input) {
      seen.push(input);
      const first = input.options[0];
      return { chosen: first ? [first.id] : [], explanation: "" };
    },
  };
  return { seen, strategy };
}

const snapshot = {
  project: { voting: { state: "closed" as const, round: 1, topN: 3 } },
  options: [option("a"), option("b")],
  // a: 21/5 = 4.2, b: 25/6 = 4.1666… — both "4.2" when rounded to one decimal
  grades: [...gradesFor("a", [4, 4, 4, 5, 4]), ...gradesFor("b", [4, 4, 4, 4, 5, 4])],
  comments: [],
  rankings: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runTally", () => {
  it("passes unrounded average grades to the strategy", async () => {
    const { seen, strategy } = capturingStrategy();
    await runTally({
      snapshot,
      strategy,
      strategyId: "test",
      strategyVersion: "0.0.0",
      triggeredBy: "owner",
      seed: "000102030405060708090a0b0c0d0e0f",
    });
    const grades = new Map(seen[0]?.grades?.map((g) => [g.optionId, g.average]));
    expect(grades.get("a")).toBeCloseTo(21 / 5, 12);
    expect(grades.get("b")).toBeCloseTo(25 / 6, 12);
    expect(grades.get("a")).not.toBe(grades.get("b"));
  });

  it("draws the seed from crypto.getRandomValues, never Math.random", async () => {
    const random = vi.spyOn(Math, "random");
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");
    const { strategy } = capturingStrategy();
    const outcome = await runTally({
      snapshot,
      strategy,
      strategyId: "test",
      strategyVersion: "0.0.0",
      triggeredBy: "owner",
      usesRandomness: true,
    });
    expect(outcome.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(getRandomValues).toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it("refuses to run without a CSPRNG instead of falling back to Math.random", async () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random");
    const { strategy } = capturingStrategy();
    await expect(
      runTally({
        snapshot,
        strategy,
        strategyId: "test",
        strategyVersion: "0.0.0",
        triggeredBy: "owner",
        usesRandomness: true,
      })
    ).rejects.toThrow(/getRandomValues/);
    expect(random).not.toHaveBeenCalled();
  });
});
