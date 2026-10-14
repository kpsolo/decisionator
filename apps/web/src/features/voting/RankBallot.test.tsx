import type { Option } from "@decisionator/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RankBallot } from "./RankBallot.js";

const sampleOptions: Option[] = [
  {
    id: "opt_1",
    title: "Option Alpha",
    description: "First deliberation candidate",
    status: "active",
    tags: ["feature"],
    pros: [],
    cons: [],
    links: [],
  },
  {
    id: "opt_2",
    title: "Option Beta",
    description: "Second deliberation candidate",
    status: "active",
    tags: ["tech-debt"],
    pros: [],
    cons: [],
    links: [],
  },
  {
    id: "opt_3",
    title: "Option Gamma",
    description: "Third deliberation candidate",
    status: "active",
    tags: ["ux"],
    pros: [],
    cons: [],
    links: [],
  },
];

describe("RankBallot component", () => {
  it("renders ballot with topN cutoff and reset order button", () => {
    const html = renderToStaticMarkup(
      <RankBallot options={sampleOptions} topN={2} onSubmitBallot={async () => {}} />
    );

    expect(html).toContain("Rank Your Top 2 Options");
    expect(html).toContain("Top 2 of 3");
    expect(html).toContain("Reset order");
    expect(html).toContain("Option Alpha");
    expect(html).toContain("Option Beta");
    expect(html).toContain("Option Gamma");
    expect(html).toContain("Top 2 cutoff");
    // Without grades, "Sort by my ratings" is not rendered
    expect(html).not.toContain("Sort by my ratings");
  });

  it("renders 'Sort by my ratings' and star badge when ownGrades are present", () => {
    const ownGrades = new Map<string, number>([
      ["opt_1", 5],
      ["opt_2", 3],
    ]);

    const html = renderToStaticMarkup(
      <RankBallot
        options={sampleOptions}
        topN={2}
        ownGrades={ownGrades}
        onSubmitBallot={async () => {}}
      />
    );

    expect(html).toContain("Sort by my ratings");
    expect(html).toContain("★ 5");
    expect(html).toContain("★ 3");
  });

  it("shows disabled notice when disabledReason is provided", () => {
    const html = renderToStaticMarkup(
      <RankBallot
        options={sampleOptions}
        topN={2}
        disabled={true}
        disabledReason="Voting has been closed by the project owner."
        onSubmitBallot={async () => {}}
      />
    );

    expect(html).toContain("Voting has been closed by the project owner.");
    expect(html).toContain("disabled");
  });
});
