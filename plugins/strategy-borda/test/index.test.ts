import { describe, expect, it } from "vitest";
import { STRATEGY_BORDA_ID } from "../src/index.js";

describe("strategy-borda", () => {
  it("exports its id", () => {
    expect(STRATEGY_BORDA_ID).toBe("org.decisionator.strategy.borda");
  });
});
