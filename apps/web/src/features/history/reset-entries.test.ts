import { describe, expect, it } from "vitest";
import { participantVoteResets } from "./reset-entries.js";

describe("participantVoteResets", () => {
  it("creates grade and ballot reset entries for participant with specified round", () => {
    const entries = participantVoteResets("participant-tom", 2);
    expect(entries).toEqual([
      {
        kind: "reset",
        scope: "participant",
        participantId: "participant-tom",
        targets: ["grades"],
      },
      {
        kind: "reset",
        scope: "participant",
        participantId: "participant-tom",
        targets: ["ballots"],
        round: 2,
      },
    ]);
  });

  it("defaults round to 1 when omitted", () => {
    const entries = participantVoteResets("participant-gina");
    expect(entries).toEqual([
      {
        kind: "reset",
        scope: "participant",
        participantId: "participant-gina",
        targets: ["grades"],
      },
      {
        kind: "reset",
        scope: "participant",
        participantId: "participant-gina",
        targets: ["ballots"],
        round: 1,
      },
    ]);
  });
});
