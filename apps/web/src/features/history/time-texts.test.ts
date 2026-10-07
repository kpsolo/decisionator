import type { EntryHistory, Grade, Ranking, Reset } from "@decisionator/core";
import { describe, expect, it } from "vitest";
import {
  averageText,
  ballotText,
  formatTime,
  optionRatings,
  ownGradeText,
  ratingLine,
} from "./time-texts.js";

// Lisbon is UTC+1 in October: 13:20Z shows as 14:20.
const format = { locale: "en-GB", timeZone: "Europe/Lisbon" };

function grade(by: string, value: Grade["value"], at: string, optionId = "lis"): Grade {
  return { id: `${by}-${at}`, by, value, at, optionId };
}
function ballot(by: string, at: string, round = 1): Ranking {
  return { id: `${by}-${at}`, by, at, round, ranking: ["lis"] };
}
function history(partial: Partial<EntryHistory>): EntryHistory {
  return { grades: [], rankings: [], properties: [], resets: [], ...partial };
}

describe("formatTime", () => {
  it("uses the given locale and time zone", () => {
    expect(formatTime("2026-10-07T13:20:00.000Z", format)).toBe("7 Oct 2026, 14:20");
    expect(formatTime("2026-10-07T13:20:00.000Z", { ...format, timeZone: "UTC" })).toBe(
      "7 Oct 2026, 13:20"
    );
  });

  it("shows only the time on the same day", () => {
    expect(formatTime("2026-10-07T13:05:00.000Z", format, "2026-10-07T13:20:00.000Z")).toBe(
      "14:05"
    );
    expect(formatTime("2026-10-06T13:05:00.000Z", format, "2026-10-07T13:20:00.000Z")).toBe(
      "6 Oct 2026, 14:05"
    );
  });
});

describe("ownGradeText", () => {
  it("shows the current grade and the one it replaced", () => {
    const text = ownGradeText({
      optionId: "lis",
      viewerId: "gina",
      grades: [grade("gina", 4, "2026-10-07T13:20:00.000Z")],
      history: history({ grades: [grade("gina", 3, "2026-10-07T13:05:00.000Z")] }),
      format,
    });
    expect(text).toBe("You rated 4 · 7 Oct 2026, 14:20\nChanged from 3 at 14:05");
  });

  it("shows only the current grade when it never changed", () => {
    expect(
      ownGradeText({
        optionId: "lis",
        viewerId: "gina",
        grades: [
          grade("tom", 2, "2026-10-07T13:31:00.000Z"),
          grade("gina", 4, "2026-10-07T13:20:00.000Z"),
        ],
        format,
      })
    ).toBe("You rated 4 · 7 Oct 2026, 14:20");
  });

  it("says who reset a cleared grade", () => {
    const reset: Reset = {
      id: "r1",
      at: "2026-10-07T15:00:00.000Z",
      by: "owner",
      scope: "all",
      targets: ["grades"],
    };
    const text = ownGradeText({
      optionId: "lis",
      viewerId: "gina",
      grades: [],
      history: history({ grades: [grade("gina", 4, "2026-10-07T13:20:00.000Z")], resets: [reset] }),
      format,
    });
    expect(text).toBe("Reset by the owner · 7 Oct 2026, 16:00");
    expect(
      ownGradeText({
        optionId: "lis",
        viewerId: "gina",
        grades: [],
        history: history({
          grades: [grade("gina", 4, "2026-10-07T13:20:00.000Z")],
          resets: [{ ...reset, byName: "Ana" }],
        }),
        format,
      })
    ).toBe("Reset by Ana · 7 Oct 2026, 16:00");
  });

  it("ignores resets of other participants and options never graded", () => {
    const h = history({
      grades: [grade("gina", 4, "2026-10-07T13:20:00.000Z")],
      resets: [
        {
          id: "r1",
          at: "2026-10-07T15:00:00.000Z",
          by: "owner",
          scope: "participant",
          participantId: "tom",
          targets: ["grades", "ballots"],
        },
      ],
    });
    expect(
      ownGradeText({ optionId: "lis", viewerId: "gina", grades: [], history: h, format })
    ).toBe(undefined);
    expect(ownGradeText({ optionId: "rio", viewerId: "gina", grades: [], format })).toBeUndefined();
    expect(ownGradeText({ optionId: "lis", viewerId: null, grades: [], format })).toBeUndefined();
  });
});

describe("averageText", () => {
  it("shows the latest effective rating of the option", () => {
    expect(
      averageText({
        optionId: "lis",
        grades: [
          grade("gina", 4, "2026-10-07T13:20:00.000Z"),
          grade("tom", 2, "2026-10-07T13:31:00.000Z"),
          grade("ana", 5, "2026-10-07T14:00:00.000Z", "rio"),
        ],
        format,
      })
    ).toBe("Last rating · 7 Oct 2026, 14:31");
    expect(averageText({ optionId: "lis", grades: [], format })).toBeUndefined();
  });
});

describe("ballotText", () => {
  it("shows when the ballot was first submitted and last updated", () => {
    expect(
      ballotText({
        viewerId: "gina",
        round: 1,
        rankings: [ballot("gina", "2026-10-07T14:10:00.000Z")],
        history: history({ rankings: [ballot("gina", "2026-10-07T14:00:00.000Z")] }),
        format,
      })
    ).toBe("Submitted 7 Oct 2026, 15:00 · updated 15:10");
  });

  it("shows a single submission and ignores other rounds", () => {
    expect(
      ballotText({
        viewerId: "gina",
        round: 2,
        rankings: [ballot("gina", "2026-10-07T14:10:00.000Z", 2)],
        history: history({ rankings: [ballot("gina", "2026-10-07T14:00:00.000Z", 1)] }),
        format,
      })
    ).toBe("Submitted 7 Oct 2026, 15:10");
    expect(ballotText({ viewerId: "gina", round: 1, rankings: [], format })).toBeUndefined();
  });

  it("starts over after a reset of the ballot", () => {
    expect(
      ballotText({
        viewerId: "gina",
        round: 1,
        rankings: [ballot("gina", "2026-10-07T14:30:00.000Z")],
        history: history({
          rankings: [ballot("gina", "2026-10-07T14:00:00.000Z")],
          resets: [
            {
              id: "r",
              at: "2026-10-07T14:20:00.000Z",
              by: "owner",
              scope: "all",
              targets: ["ballots"],
              round: 1,
            },
          ],
        }),
        format,
      })
    ).toBe("Submitted 7 Oct 2026, 15:30");
  });
});

describe("owner ratings", () => {
  it("lists each participant's grade by name with its time", () => {
    const ratings = optionRatings(
      "lis",
      [
        grade("u-tom", 2, "2026-10-07T13:31:00.000Z"),
        { ...grade("g-1", 4, "2026-10-07T13:20:00.000Z"), byName: "Gina" },
        grade("u-ana", 5, "2026-10-07T13:00:00.000Z", "rio"),
      ],
      (id) => (id === "u-tom" ? "Tom" : undefined)
    );
    const now = new Date("2026-10-07T18:00:00.000Z");
    expect(ratings.map((r) => ratingLine(r, format, now))).toEqual([
      "Gina 4 · 14:20",
      "Tom 2 · 14:31",
    ]);
    expect(
      ratingLine(ratings[0] as (typeof ratings)[0], format, new Date("2026-10-09T10:00:00Z"))
    ).toBe("Gina 4 · 7 Oct 2026, 14:20");
  });
});
