import type { Entry } from "@decisionator/plugin-sdk";

export type ResetEntry = Extract<Entry, { kind: "reset" }>;

/**
 * Creates reset entries to drop a specific participant's votes (grades and ballots for the current round).
 * Follows Data Model §9.
 */
export function participantVoteResets(participantId: string, round = 1): ResetEntry[] {
  return [
    {
      kind: "reset",
      scope: "participant",
      participantId,
      targets: ["grades"],
    },
    {
      kind: "reset",
      scope: "participant",
      participantId,
      targets: ["ballots"],
      round,
    },
  ];
}
