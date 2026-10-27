import { type OutcomeRecord, deriveDrawSeed } from "@decisionator/core";
import { describe, expect, it } from "vitest";
import { drawIntegrity, drawIntegrityMessages } from "./draw-integrity.js";

function outcome(patch: Partial<OutcomeRecord> = {}): OutcomeRecord {
  const base: OutcomeRecord = {
    round: 1,
    strategy: { id: "org.decisionator.strategy.random", version: "0.1.0" },
    settings: {},
    inputs: {
      options: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      settings: {},
    },
    result: { winner: "a", order: [{ optionId: "a" }, { optionId: "b" }] },
    tieBreak: "none",
    triggeredBy: "owner",
    at: "2026-01-01T10:00:00.000Z",
    ...patch,
  };
  return base;
}

describe("drawIntegrity", () => {
  it("is null for an undecided round", () => {
    expect(drawIntegrity([outcome()], 2)).toBeNull();
  });

  it("confirms a verifiable draw", () => {
    const o = outcome();
    const verified = { ...o, seed: deriveDrawSeed(o) };
    const d = drawIntegrity([verified], 1);
    expect(d?.seed.status).toBe("verified");
    expect(d && drawIntegrityMessages(d)).toEqual([
      expect.objectContaining({ tone: "ok", text: expect.stringMatching(/^Verifiable draw/) }),
    ]);
  });

  it("marks a legacy random seed as unverifiable without failing", () => {
    const d = drawIntegrity([outcome({ seed: "0123456789abcdef0123456789abcdef" })], 1);
    expect(d?.seed.status).toBe("unverifiable");
    expect(d && drawIntegrityMessages(d)[0]).toMatchObject({
      tone: "warning",
      text: expect.stringMatching(/^Legacy \/ unverifiable draw/),
    });
  });

  it("says nothing about the seed when no draw took part", () => {
    const d = drawIntegrity([outcome()], 1);
    expect(d && drawIntegrityMessages(d)).toEqual([]);
  });

  it("counts re-decisions of the round and uses the latest outcome", () => {
    const first = outcome({ at: "2026-01-01T10:00:00.000Z" });
    const second = outcome({ at: "2026-01-01T11:00:00.000Z", result: { winner: "b", order: [] } });
    const third = outcome({ at: "2026-01-01T12:00:00.000Z" });
    const d = drawIntegrity([first, third, second, outcome({ round: 2 })], 1);
    expect(d?.outcome).toBe(third);
    expect(d?.redecided).toBe(2);
    expect(d && drawIntegrityMessages(d).map((m) => m.text)).toContain(
      "This round was re-decided 2 times. Every earlier outcome is kept in the history."
    );
  });
});
