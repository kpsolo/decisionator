import { describe, expect, it } from "vitest";
import { withOwnerPick } from "./DecisionMethod.js";

describe("withOwnerPick", () => {
  it("sets the pick and keeps other settings", () => {
    expect(withOwnerPick({ other: 1 }, "opt_2")).toEqual({ other: 1, pick: "opt_2" });
    expect(withOwnerPick({ pick: "opt_1" }, "opt_2")).toEqual({ pick: "opt_2" });
  });

  it('clears a previous pick for "Choose when closing"', () => {
    expect(withOwnerPick({ pick: "opt_1", other: 1 }, "")).toEqual({ other: 1 });
    expect(withOwnerPick({}, "")).toEqual({});
  });
});
