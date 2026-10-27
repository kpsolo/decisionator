import { type Option, verifyOutcomeSeed } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import { compareStrategies } from "./compare.js";
import { BUILTIN_STRATEGIES, WEIGHTED_ID, cannotRunReason, chosenStrategy } from "./strategies.js";

const option = (id: string): Option =>
  ({
    id,
    title: id.toUpperCase(),
    description: "",
    status: "active",
    tags: [],
    pros: [],
    cons: [],
    links: [],
  }) as Option;

function snapshot(patch: Partial<ProjectSnapshot["project"]> = {}): ProjectSnapshot {
  return {
    project: {
      title: "Offsite",
      description: "",
      protected: false,
      formatVersion: 2,
      voting: { state: "open", round: 1, topN: 3, liveResults: true },
      ...patch,
    },
    options: [option("lis"), option("alp"), option("bcn")],
    grades: [
      { id: "g1", at: "2026-01-01T10:00:00.000Z", by: "gina", optionId: "lis", value: 2 },
      { id: "g2", at: "2026-01-01T10:00:00.000Z", by: "gina", optionId: "bcn", value: 5 },
      { id: "g3", at: "2026-01-01T10:00:00.000Z", by: "tom", optionId: "bcn", value: 4 },
    ],
    comments: [],
    rankings: [
      {
        id: "r1",
        at: "2026-01-01T10:00:00.000Z",
        by: "gina",
        round: 1,
        ranking: ["lis", "alp", "bcn"],
      },
      {
        id: "r2",
        at: "2026-01-01T10:00:00.000Z",
        by: "tom",
        round: 1,
        ranking: ["lis", "bcn", "alp"],
      },
    ],
    outcomes: [],
    role: "owner",
  } as ProjectSnapshot;
}

describe("chosenStrategy", () => {
  it("defaults to Borda with the voting top N", () => {
    const c = chosenStrategy(snapshot());
    expect(c).toMatchObject({
      id: "org.decisionator.strategy.borda",
      stored: false,
      settings: { topN: 3 },
    });
  });

  it("uses the stored choice and says when it is not available", () => {
    const s = snapshot({ strategy: { id: WEIGHTED_ID, version: "0.1.0", settings: {} } });
    expect(chosenStrategy(s).name).toBe("Random Weighted by Grades");
    const missing = chosenStrategy(
      s,
      BUILTIN_STRATEGIES.filter((x) => x.id !== WEIGHTED_ID)
    );
    expect(missing.descriptor).toBeNull();
    expect(cannotRunReason(s, missing)).toBe(
      "Random Weighted by Grades is not available. Choose another method before closing the vote."
    );
  });
});

describe("compareStrategies", () => {
  it("runs every strategy on the same votes and reproduces the seed", async () => {
    const snap = snapshot();
    const rows = await compareStrategies(snap, BUILTIN_STRATEGIES, "owner");
    expect(rows.map((r) => r.strategyId)).toEqual(BUILTIN_STRATEGIES.map((s) => s.id));
    const borda = rows.find((r) => r.strategyId === "org.decisionator.strategy.borda");
    expect(borda?.ok && borda.winner).toBe("lis");

    const again = await compareStrategies(snap, BUILTIN_STRATEGIES, "owner");
    const rnd = (rs: typeof rows) =>
      rs.find((r) => r.strategyId === "org.decisionator.strategy.random");
    const a = rnd(rows);
    const b = rnd(again);
    expect(a?.ok && b?.ok && a.winner === b.winner && a.seed === b.seed).toBe(true);
    expect(a?.ok && verifyOutcomeSeed(a.preview).status).toBe("verified");
  });

  it("explains a strategy that cannot run and marks winners that differ from the chosen one", async () => {
    const rows = await compareStrategies(snapshot(), BUILTIN_STRATEGIES, "owner");
    const pick = rows.find((r) => r.strategyId === "org.decisionator.strategy.owner-pick");
    expect(pick?.ok).toBe(false);
    for (const r of rows) {
      if (r.ok) expect(r.differsFromChosen).toBe(r.winner !== "lis");
    }
  });
});

describe("adopting a comparison row", () => {
  it("records the previewed draw with the publicly derived seed", async () => {
    const snap = snapshot();
    const rows = await compareStrategies(snap, BUILTIN_STRATEGIES, "owner");
    const rnd = rows.find((r) => r.strategyId === "org.decisionator.strategy.random");
    if (!rnd?.ok) throw new Error("random row should run");

    const first = await rnd.adopt();
    const second = await rnd.adopt();
    // Re-adopting cannot re-roll the draw: same votes, same seed, same winner.
    expect(first.seed).toBe(rnd.preview.seed);
    expect(second.seed).toBe(first.seed);
    expect(first.result).toEqual(rnd.preview.result);
    expect(verifyOutcomeSeed(first).status).toBe("verified");
    expect(first.strategy.id).toBe("org.decisionator.strategy.random");
    expect(first.triggeredBy).toBe("owner");
  });

  it("changes the draw only when the recorded inputs change", async () => {
    const snap = snapshot();
    const before = (await compareStrategies(snap, BUILTIN_STRATEGIES, "owner")).find(
      (r) => r.strategyId === "org.decisionator.strategy.random"
    );
    const moreVotes = {
      ...snap,
      rankings: [
        ...snap.rankings,
        { id: "r3", at: "2026-01-01T11:00:00.000Z", by: "ann", round: 1, ranking: ["bcn"] },
      ],
    } as ProjectSnapshot;
    const after = (await compareStrategies(moreVotes, BUILTIN_STRATEGIES, "owner")).find(
      (r) => r.strategyId === "org.decisionator.strategy.random"
    );
    expect(before?.ok && after?.ok && before.seed !== after.seed).toBe(true);
  });
});
