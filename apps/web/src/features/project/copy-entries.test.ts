import type { AppendOptions, Entry, ProjectStore } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import { copyEntriesAsAuthors } from "./copy-entries.js";

function recordingStore(me: string) {
  const calls: { entries: Entry[]; opts?: AppendOptions }[] = [];
  const store = {
    id: "test.store",
    signIn: async () => ({ participantId: me, displayName: me }),
    append: async (_ref: unknown, entries: Entry[], opts?: AppendOptions) => {
      calls.push(opts === undefined ? { entries } : { entries, opts });
      return { queued: 0, sent: entries.length };
    },
  } as unknown as ProjectStore;
  return { store, calls };
}

describe("copyEntriesAsAuthors", () => {
  it("appends other participants' entries on their behalf and the mover's own normally", async () => {
    const { store, calls } = recordingStore("me@example.com");
    const at = "2026-10-06T00:00:00Z";
    const outcome = {
      strategy: { id: "s", version: "1.0.0" },
      settings: {},
      inputs: { options: [{ id: "o1", title: "One" }] },
      result: { winner: "o1", order: [{ optionId: "o1" }] },
      tieBreak: "none" as const,
      triggeredBy: "me@example.com",
      at,
    };

    await copyEntriesAsAuthors(
      store,
      { store: "test", id: "p1" },
      {
        grades: [
          { id: "g1", at, by: "me@example.com", optionId: "o1", value: 5 },
          { id: "g2", at, by: "peer:a", byName: "Ann", optionId: "o1", value: 2 },
          { id: "g3", at, by: "bob@example.com", optionId: "o1", value: 4 },
        ],
        comments: [{ id: "c1", at, by: "peer:a", byName: "Ann", optionId: "o1", body: "Hi" }],
        rankings: [{ id: "r1", at, by: "bob@example.com", round: 1, ranking: ["o1"] }],
        outcomes: [outcome],
      }
    );

    expect(calls).toEqual([
      { entries: [{ kind: "grade", optionId: "o1", value: 5 }] },
      {
        entries: [
          { kind: "grade", optionId: "o1", value: 2 },
          { kind: "comment", optionId: "o1", body: "Hi", hidden: undefined },
        ],
        opts: { onBehalfOf: { participantId: "peer:a", displayName: "Ann" } },
      },
      {
        entries: [
          { kind: "grade", optionId: "o1", value: 4 },
          { kind: "ranking", ranking: ["o1"], round: 1 },
        ],
        opts: { onBehalfOf: { participantId: "bob@example.com" } },
      },
      { entries: [{ kind: "outcome", outcome }] },
    ]);
  });
});
