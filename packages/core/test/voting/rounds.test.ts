import { describe, expect, it } from "vitest";
import type { Option, Ranking } from "../../src/model/index.js";
import {
  type ExtendedVotingState,
  closeVotingRound,
  getEffectiveBallots,
  openNextRound,
} from "../../src/voting/rounds.js";

describe("Voting Rounds & Ballots (T076)", () => {
  const activeOptions: Option[] = [
    {
      id: "opt_1",
      order: 1,
      status: "active",
      title: "Option 1",
      description: "",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
    {
      id: "opt_2",
      order: 2,
      status: "active",
      title: "Option 2",
      description: "",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
    {
      id: "opt_3",
      order: 3,
      status: "active",
      title: "Option 3",
      description: "",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
    {
      id: "opt_archived",
      order: 4,
      status: "removed",
      title: "Archived Option",
      description: "",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
  ];

  it("transitions states: open(n) -> closed(n) -> open(n+1)", () => {
    const round1: ExtendedVotingState = {
      state: "open",
      round: 1,
      topN: 3,
      liveResults: true,
    };

    const closed = closeVotingRound(round1, "2026-10-05T12:00:00Z");
    expect(closed.state).toBe("closed");
    expect(closed.round).toBe(1);
    expect(closed.closedAt).toBe("2026-10-05T12:00:00Z");

    const round2 = openNextRound(closed);
    expect(round2.state).toBe("open");
    expect(round2.round).toBe(2);
    expect(round2.closedAt).toBeUndefined();
  });

  it("extracts latest ballot per participant, drops duplicates, non-active options, and caps at topN", () => {
    const rankings: Ranking[] = [
      {
        id: "b1",
        at: "2026-10-05T10:00:00Z",
        by: "alice",
        round: 1,
        ranking: ["opt_1", "opt_2", "opt_3"],
      },
      {
        id: "b2",
        at: "2026-10-05T10:30:00Z",
        by: "alice", // Re-submitted later, replaces b1
        round: 1,
        ranking: ["opt_2", "opt_1", "opt_archived", "opt_3"], // includes archived & more than topN
      },
      {
        id: "b3",
        at: "2026-10-05T11:00:00Z",
        by: "bob",
        round: 1,
        ranking: ["opt_1", "opt_1", "opt_3"], // duplicate opt_1
      },
      {
        id: "b4_late",
        at: "2026-10-05T13:00:00Z",
        by: "carol",
        round: 1,
        ranking: ["opt_3"],
      },
    ];

    const effective = getEffectiveBallots(
      rankings,
      1,
      activeOptions,
      2, // topN = 2
      "2026-10-05T12:00:00Z" // closed at 12:00
    );

    // Carol's late ballot dropped
    expect(effective.some((e) => e.by === "carol")).toBe(false);

    // Alice's latest ballot took effect: opt_2, opt_1 (archived skipped, capped at topN=2)
    const aliceBallot = effective.find((e) => e.by === "alice");
    expect(aliceBallot?.ranking).toEqual(["opt_2", "opt_1"]);

    // Bob's ballot: duplicate removed -> opt_1, opt_3
    const bobBallot = effective.find((e) => e.by === "bob");
    expect(bobBallot?.ranking).toEqual(["opt_1", "opt_3"]);
  });
});
