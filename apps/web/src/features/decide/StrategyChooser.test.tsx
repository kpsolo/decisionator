import type { ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StrategyChooser, initialStrategyId } from "./StrategyChooser.js";
import { BORDA_ID, OWNER_PICK_ID } from "./strategies.js";

vi.mock("../plugins/plugin-registry.js", () => ({
  getInstalledPlugins: () => [
    { id: "org.decisionator.strategy.borda", enabled: false },
    { id: "org.decisionator.strategy.random", enabled: false },
  ],
}));

const snapshot = {
  project: { title: "P", voting: { state: "open", round: 1, topN: 3, liveResults: true } },
  options: [
    {
      id: "o1",
      title: "One",
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
  ],
  grades: [],
  rankings: [],
  outcomes: [],
  comments: [],
} as unknown as ProjectSnapshot;

describe("initialStrategyId", () => {
  const ids = (...list: string[]) => list.map((id) => ({ id }));

  it("keeps the strategy in force when it is available", () => {
    expect(initialStrategyId(ids(BORDA_ID, OWNER_PICK_ID), BORDA_ID)).toBe(BORDA_ID);
  });

  it("never selects a disabled strategy", () => {
    expect(initialStrategyId(ids(OWNER_PICK_ID), BORDA_ID)).toBe(OWNER_PICK_ID);
    expect(initialStrategyId([], BORDA_ID)).toBe("");
  });
});

describe("StrategyChooser", () => {
  it("lists only enabled strategies", () => {
    const html = renderToStaticMarkup(
      <StrategyChooser
        snapshot={snapshot}
        store={{} as ProjectStore}
        projectRef={{ store: "memory", id: "p" }}
        currentUser="me"
        isOwner
      />
    );
    expect(html).toContain("Owner Direct Pick");
    expect(html).toContain("Random Weighted by Grades");
    expect(html).not.toContain("Borda Count Ranking");
    expect(html).not.toContain("Uniform Random Draw");
  });
});
