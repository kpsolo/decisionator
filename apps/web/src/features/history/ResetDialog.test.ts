import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import { resetSummary, voters } from "./ResetDialog.js";

const at = "2026-01-01T10:00:00.000Z";
const snapshot = {
  project: {
    title: "T",
    description: "",
    protected: false,
    formatVersion: 2,
    voting: { state: "open", round: 1, topN: 3, liveResults: true },
  },
  options: [],
  grades: [
    { id: "1", at, by: "owner", optionId: "a", value: 5 },
    { id: "2", at, by: "peer:gina", byName: "Gina", optionId: "a", value: 4 },
    { id: "3", at, by: "peer:tom", byName: "Tom", optionId: "a", value: 2 },
    { id: "4", at, by: "peer:tom", byName: "Tom", optionId: "b", value: 3 },
  ],
  comments: [],
  rankings: [{ id: "r", at, by: "peer:tom", byName: "Tom", round: 1, ranking: ["a"] }],
  outcomes: [],
  role: "owner",
} as unknown as ProjectSnapshot;

describe("reset dialog helpers", () => {
  it("lists voters by name", () => {
    expect(voters(snapshot)).toEqual([
      { id: "peer:gina", name: "Gina" },
      { id: "owner", name: "owner" },
      { id: "peer:tom", name: "Tom" },
    ]);
  });

  it("states what will be cleared and for whom", () => {
    expect(
      resetSummary({ snapshot, who: "peer:tom", name: "Tom", votes: true, properties: [] })
    ).toBe("Clear 2 grades and 1 ballot from Tom?");
    expect(resetSummary({ snapshot, who: null, name: "", votes: true, properties: [] })).toBe(
      "Clear 4 grades and 1 ballot from everyone?"
    );
    expect(
      resetSummary({ snapshot, who: null, name: "", votes: false, properties: ["Cost per person"] })
    ).toBe("Clear Cost per person on every option?");
  });
});
