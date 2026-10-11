import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import type { LiveGuestInfo } from "@decisionator/share-inpage";
import { buildRoster } from "./participant-roster.js";

function mockSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      title: "Test Deliberation",
      description: "",
      protected: false,
      formatVersion: 2,
      voting: { state: "open", round: 1, topN: 3, liveResults: true },
    },
    options: [
      { id: "opt1", title: "Option 1", description: "", status: "active", order: 1, tags: [], pros: [], cons: [], links: [], at: "2026-10-11T00:00:00Z", by: "host-1" },
      { id: "opt2", title: "Option 2", description: "", status: "active", order: 2, tags: [], pros: [], cons: [], links: [], at: "2026-10-11T00:00:00Z", by: "host-1" },
    ],
    grades: [],
    comments: [],
    rankings: [],
    outcomes: [],
    contributions: [],
    properties: [],
    role: "owner",
    ...overrides,
  };
}

describe("buildRoster", () => {
  it("includes host and connected guests", () => {
    const snapshot = mockSnapshot();
    const guests: LiveGuestInfo[] = [
      {
        participantId: "guest-alice",
        name: "Alice",
        connections: 1,
        joinedAt: "2026-10-11T10:00:00Z",
      },
    ];

    const roster = buildRoster(snapshot, guests, "host-1");

    expect(roster).toHaveLength(2);
    const hostProfile = roster.find((p) => p.participantId === "host-1");
    const aliceProfile = roster.find((p) => p.participantId === "guest-alice");

    expect(hostProfile).toBeDefined();
    expect(hostProfile?.isHost).toBe(true);
    expect(hostProfile?.online).toBe(true);

    expect(aliceProfile).toBeDefined();
    expect(aliceProfile?.name).toBe("Alice");
    expect(aliceProfile?.isHost).toBe(false);
    expect(aliceProfile?.online).toBe(true);
    expect(aliceProfile?.gradeCount).toBe(0);
    expect(aliceProfile?.hasBallot).toBe(false);
  });

  it("calculates effective grades and ballot status for participants", () => {
    const snapshot = mockSnapshot({
      grades: [
        { id: "g1", at: "2026-10-11T10:01:00Z", by: "guest-alice", byName: "Alice", optionId: "opt1", value: 4 },
        { id: "g2", at: "2026-10-11T10:01:05Z", by: "guest-alice", byName: "Alice", optionId: "opt2", value: 5 },
        { id: "g3", at: "2026-10-11T10:02:00Z", by: "guest-bob", byName: "Bob", optionId: "opt1", value: 2 },
      ],
      rankings: [
        { id: "r1", at: "2026-10-11T10:03:00Z", by: "guest-alice", byName: "Alice", round: 1, ranking: ["opt2", "opt1"] },
      ],
    });

    const guests: LiveGuestInfo[] = [
      { participantId: "guest-alice", name: "Alice", connections: 1, joinedAt: "2026-10-11T10:00:00Z" },
    ];

    const roster = buildRoster(snapshot, guests, "host-1");

    const alice = roster.find((p) => p.participantId === "guest-alice");
    expect(alice?.gradeCount).toBe(2);
    expect(alice?.hasBallot).toBe(true);
    expect(alice?.online).toBe(true);

    // Bob submitted earlier but is not currently connected in guests
    const bob = roster.find((p) => p.participantId === "guest-bob");
    expect(bob).toBeDefined();
    expect(bob?.name).toBe("Bob");
    expect(bob?.online).toBe(false);
    expect(bob?.gradeCount).toBe(1);
    expect(bob?.hasBallot).toBe(false);
  });

  it("handles round filtering for ballots", () => {
    const snapshot = mockSnapshot({
      project: {
        title: "Test Deliberation",
        description: "",
        protected: false,
        formatVersion: 2,
        voting: { state: "open", round: 2, topN: 3, liveResults: true },
      },
      rankings: [
        // Round 1 ballot from Alice (older round)
        { id: "r1", at: "2026-10-11T09:00:00Z", by: "guest-alice", byName: "Alice", round: 1, ranking: ["opt1"] },
        // Round 2 ballot from Bob
        { id: "r2", at: "2026-10-11T10:00:00Z", by: "guest-bob", byName: "Bob", round: 2, ranking: ["opt2"] },
      ],
    });

    const guests: LiveGuestInfo[] = [
      { participantId: "guest-alice", name: "Alice", connections: 1, joinedAt: "2026-10-11T10:00:00Z" },
      { participantId: "guest-bob", name: "Bob", connections: 1, joinedAt: "2026-10-11T10:00:00Z" },
    ];

    const roster = buildRoster(snapshot, guests, "host-1");

    const alice = roster.find((p) => p.participantId === "guest-alice");
    const bob = roster.find((p) => p.participantId === "guest-bob");

    // Alice only has round 1 ballot, current round is 2
    expect(alice?.hasBallot).toBe(false);
    // Bob has round 2 ballot
    expect(bob?.hasBallot).toBe(true);
  });
});
