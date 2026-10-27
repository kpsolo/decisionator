import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grade, Option } from "../src/index.js";
import {
  type TallyStrategyInput,
  type TallyStrategyPlugin,
  deriveDrawSeed,
  runTally,
  verifyOutcomeSeed,
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
    });
    const grades = new Map(seen[0]?.grades?.map((g) => [g.optionId, g.average]));
    expect(grades.get("a")).toBeCloseTo(21 / 5, 12);
    expect(grades.get("b")).toBeCloseTo(25 / 6, 12);
    expect(grades.get("a")).not.toBe(grades.get("b"));
  });

  it("derives the recorded seed publicly from the inputs, without any randomness source", async () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random");
    const { strategy } = capturingStrategy();
    const run = () =>
      runTally({
        snapshot,
        strategy,
        strategyId: "test",
        strategyVersion: "0.0.0",
        triggeredBy: "owner",
        usesRandomness: true,
      });
    const first = await run();
    const second = await run();
    expect(first.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(second.seed).toBe(first.seed);
    expect(first.seed).toBe(deriveDrawSeed(first));
    expect(verifyOutcomeSeed(first)).toEqual({ status: "verified", seed: first.seed });
    expect(random).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied seed", async () => {
    const { strategy } = capturingStrategy();
    await expect(
      runTally({
        snapshot,
        strategy,
        strategyId: "test",
        strategyVersion: "0.0.0",
        triggeredBy: "owner",
        usesRandomness: true,
        seed: "000102030405060708090a0b0c0d0e0f",
      } as Parameters<typeof runTally>[0])
    ).rejects.toThrow(/caller-supplied seed/);
  });

  it("gives a different seed when the round, strategy or inputs change", async () => {
    const { strategy } = capturingStrategy();
    const base = {
      snapshot,
      strategy,
      strategyId: "test",
      strategyVersion: "0.0.0",
      triggeredBy: "owner",
      usesRandomness: true,
    };
    const a = await runTally(base);
    const b = await runTally({
      ...base,
      snapshot: { ...snapshot, project: { voting: { ...snapshot.project.voting, round: 2 } } },
    });
    const c = await runTally({ ...base, strategyId: "other" });
    const d = await runTally({ ...base, snapshot: { ...snapshot, options: [option("a")] } });
    expect(new Set([a.seed, b.seed, c.seed, d.seed]).size).toBe(4);
  });
});
