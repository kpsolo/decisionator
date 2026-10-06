import { runStrategyContractTests } from "@decisionator/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { ownerPickStrategy } from "../src/index.js";

describe("Owner Pick Strategy Contract Compliance (T090, T091)", () => {
  const sampleInput = {
    options: [
      { id: "opt-1", title: "Option 1" },
      { id: "opt-2", title: "Option 2" },
    ],
    settings: {},
    runInput: "opt-1",
  };

  runStrategyContractTests(ownerPickStrategy, {
    minOptions: 1,
    sampleInput,
  });

  it("fails check when runInput is missing or option not in list", () => {
    expect(
      ownerPickStrategy.check({
        options: [{ id: "opt-1", title: "Option 1" }],
        settings: {},
        runInput: undefined,
      }).ok
    ).toBe(false);

    expect(
      ownerPickStrategy.check({
        options: [{ id: "opt-1", title: "Option 1" }],
        settings: {},
        runInput: "opt-unknown",
      }).ok
    ).toBe(false);
  });

  it("selects the chosen option with explanation", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing decide
    const res = ownerPickStrategy.decide(sampleInput, {} as any) as unknown as {
      chosen: string[];
      explanation: string;
      order: { optionId: string }[];
    };
    expect(res.chosen).toEqual(["opt-1"]);
    expect(res.explanation).toContain("Owner selected");
    expect(res.order[0]?.optionId).toBe("opt-1");
  });
});
