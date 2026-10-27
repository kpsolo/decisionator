import { describe, expect, it } from "vitest";
import {
  DRAW_SEED_DOMAIN,
  canonicalJson,
  deriveDrawSeed,
  drawSeedMaterial,
  verifyOutcomeSeed,
} from "../src/strategy-host/draw-seed.js";
import { redecidedCount } from "../src/voting/rounds.js";

const outcome = {
  round: 1,
  strategy: { id: "org.decisionator.strategy.random", version: "0.1.0" },
  inputs: {
    options: [
      { id: "lis", title: "Lisbon" },
      { id: "bcn", title: "Barcelona" },
    ],
    ballots: [{ by: "gina", ranking: ["lis", "bcn"] }],
    grades: [{ optionId: "bcn", average: 4.5, count: 2 }],
    settings: {},
  },
};

describe("canonicalJson", () => {
  it("sorts keys, drops undefined members and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: [3, 1, { d: undefined, c: "x" }], e: undefined })).toBe(
      '{"a":[3,1,{"c":"x"}],"b":1}'
    );
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
  });
});

describe("deriveDrawSeed", () => {
  it("is a frozen function of the documented material (contract vector)", () => {
    expect(DRAW_SEED_DOMAIN).toBe("decisionator/draw-seed/v1");
    expect(drawSeedMaterial(outcome)).toBe(
      '{"ballots":[{"by":"gina","ranking":["lis","bcn"]}],"grades":[{"average":4.5,"count":2,"optionId":"bcn"}],"options":[{"id":"lis"},{"id":"bcn"}],"round":1,"settings":{},"strategy":{"id":"org.decisionator.strategy.random","version":"0.1.0"}}'
    );
    expect(deriveDrawSeed(outcome)).toBe(CONTRACT_VECTOR_SEED);
  });

  it("ignores option titles but not option order", () => {
    const retitled = {
      ...outcome,
      inputs: {
        ...outcome.inputs,
        options: outcome.inputs.options.map((o) => ({ ...o, title: "?" })),
      },
    };
    expect(deriveDrawSeed(retitled)).toBe(deriveDrawSeed(outcome));
    const reordered = {
      ...outcome,
      inputs: { ...outcome.inputs, options: [...outcome.inputs.options].reverse() },
    };
    expect(deriveDrawSeed(reordered)).not.toBe(deriveDrawSeed(outcome));
  });
});

describe("verifyOutcomeSeed", () => {
  it("verifies a derived seed", () => {
    const seed = deriveDrawSeed(outcome);
    expect(verifyOutcomeSeed({ ...outcome, seed })).toEqual({ status: "verified", seed });
    expect(verifyOutcomeSeed({ ...outcome, seed: seed.toUpperCase() }).status).toBe("verified");
  });

  it("reports no draw when no seed is recorded", () => {
    expect(verifyOutcomeSeed(outcome)).toEqual({ status: "no-draw" });
  });

  it("marks a legacy CSPRNG seed as unverifiable instead of failing", () => {
    const legacy = { ...outcome, seed: "000102030405060708090a0b0c0d0e0f" };
    expect(verifyOutcomeSeed(legacy)).toEqual({
      status: "unverifiable",
      recorded: "000102030405060708090a0b0c0d0e0f",
      expected: deriveDrawSeed(outcome),
    });
  });

  it("catches inputs altered after the draw", () => {
    const seed = deriveDrawSeed(outcome);
    const tampered = {
      ...outcome,
      seed,
      inputs: { ...outcome.inputs, ballots: [{ by: "gina", ranking: ["bcn", "lis"] }] },
    };
    expect(verifyOutcomeSeed(tampered).status).toBe("unverifiable");
  });

  it("never throws on malformed recorded inputs", () => {
    const broken = {
      ...outcome,
      seed: "000102030405060708090a0b0c0d0e0f",
      inputs: { ...outcome.inputs, settings: { x: Number.POSITIVE_INFINITY } },
    };
    expect(verifyOutcomeSeed(broken)).toMatchObject({ status: "unverifiable", expected: null });
  });
});

describe("redecidedCount", () => {
  it("counts outcomes of a round beyond the first", () => {
    const at = "2026-01-01T00:00:00Z";
    const list = [{ round: 1, at }, { at }, { round: 1, at }, { round: 2, at }];
    expect(redecidedCount(list, 1)).toBe(2);
    expect(redecidedCount(list, 2)).toBe(0);
    expect(redecidedCount(list, 3)).toBe(0);
  });
});

/** Computed independently with Node's `crypto` from the material above (strategy contract). */
const CONTRACT_VECTOR_SEED = "734c77096ba776675113181458a32bfd";
