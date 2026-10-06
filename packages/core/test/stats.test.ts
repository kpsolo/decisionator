import { describe, expect, it } from "vitest";
import type { Comment, Grade, Option } from "../src/index.js";
import { computeOptionStats, sortAndGroupStats } from "../src/stats/aggregate.js";

describe("Stats Aggregation & Sorting (T055)", () => {
  const options: Option[] = [
    {
      id: "opt_1",
      title: "Option Alpha",
      description: "",
      category: "Engineering",
      tags: ["quick", "core"],
      status: "active",
      pros: [],
      cons: [],
      links: [],
    },
    {
      id: "opt_2",
      title: "Option Beta",
      description: "",
      category: "Design",
      tags: ["quick"],
      status: "active",
      pros: [],
      cons: [],
      links: [],
    },
    {
      id: "opt_3",
      title: "Option Gamma",
      description: "",
      category: "Engineering",
      tags: [],
      status: "active",
      pros: [],
      cons: [],
      links: [],
    },
  ];

  const grades: Grade[] = [
    { id: "g1", at: "2026-10-05T01:00:00Z", by: "alice", optionId: "opt_1", value: 3 },
    { id: "g2", at: "2026-10-05T02:00:00Z", by: "alice", optionId: "opt_1", value: 5 }, // overrides g1
    { id: "g3", at: "2026-10-05T01:30:00Z", by: "bob", optionId: "opt_1", value: 4 },
    { id: "g4", at: "2026-10-05T01:00:00Z", by: "alice", optionId: "opt_2", value: 2 },
  ];

  const comments: Comment[] = [
    { id: "c1", at: "2026-10-05T01:00:00Z", by: "alice", optionId: "opt_1", body: "Hello" },
    {
      id: "c2",
      at: "2026-10-05T02:00:00Z",
      by: "bob",
      optionId: "opt_1",
      body: "Hidden",
      hidden: true,
    },
  ];

  it("calculates 1-decimal average, count, distribution, and comments count accurately", () => {
    const statsMap = computeOptionStats(options, grades, comments);
    const opt1Stats = statsMap.get("opt_1");
    expect(opt1Stats).toBeDefined();
    // opt_1 has latest grades: alice=5, bob=4 -> avg = 4.5, count = 2
    expect(opt1Stats?.average).toBe(4.5);
    expect(opt1Stats?.count).toBe(2);
    expect(opt1Stats?.distribution).toEqual([0, 0, 0, 1, 1]); // 4-star, 5-star
    expect(opt1Stats?.commentsCount).toBe(1); // c2 was hidden
  });

  it("sorts by average, count, and title", () => {
    const statsMap = computeOptionStats(options, grades, comments);
    const statsList = Array.from(statsMap.values());

    const sortedByAvg = sortAndGroupStats(statsList, "average", "none");
    expect(sortedByAvg[0]?.items[0]?.optionId).toBe("opt_1"); // 4.5
    expect(sortedByAvg[0]?.items[1]?.optionId).toBe("opt_2"); // 2.0
    expect(sortedByAvg[0]?.items[2]?.optionId).toBe("opt_3"); // 0.0

    const sortedByTitle = sortAndGroupStats(statsList, "title", "none");
    expect(sortedByTitle[0]?.items.map((i) => i.title)).toEqual([
      "Option Alpha",
      "Option Beta",
      "Option Gamma",
    ]);
  });

  it("groups by category and tag", () => {
    const statsMap = computeOptionStats(options, grades, comments);
    const statsList = Array.from(statsMap.values());

    const groupedCat = sortAndGroupStats(statsList, "title", "category");
    expect(groupedCat.length).toBe(2); // Engineering & Design

    const groupedTag = sortAndGroupStats(statsList, "title", "tag");
    // "quick" has opt_1 and opt_2; "core" has opt_1; Untagged has opt_3
    const quickGroup = groupedTag.find((g) => g.groupName === "quick");
    expect(quickGroup?.items.length).toBe(2);
  });

  it("SC-008 performance gate: 200 options sorted and grouped in < 1 second", () => {
    const bigOptions: Option[] = [];
    const bigGrades: Grade[] = [];
    const bigComments: Comment[] = [];

    for (let i = 0; i < 200; i++) {
      const id = `opt_${i}`;
      bigOptions.push({
        id,
        title: `Option ${i}`,
        description: "",
        category: `Cat_${i % 5}`,
        tags: [`tag_${i % 10}`, `tag_${(i + 1) % 10}`],
        status: "active",
        pros: [],
        cons: [],
        links: [],
      });
      // 5 grades each
      for (let u = 0; u < 5; u++) {
        const val = ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5;
        bigGrades.push({
          id: `g_${i}_${u}`,
          at: new Date().toISOString(),
          by: `user_${u}`,
          optionId: id,
          value: val,
        });
      }
    }

    const start = performance.now();
    const statsMap = computeOptionStats(bigOptions, bigGrades, bigComments);
    const statsList = Array.from(statsMap.values());
    const grouped = sortAndGroupStats(statsList, "average", "category");
    const elapsed = performance.now() - start;

    expect(grouped.length).toBe(5);
    expect(elapsed).toBeLessThan(1000); // well under 1 s
  });
});
