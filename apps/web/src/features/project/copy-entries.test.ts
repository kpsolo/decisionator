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

  it("re-appends person property values under their author and shared ones as the mover", async () => {
    const { store, calls } = recordingStore("me@example.com");
    const value = (
      id: string,
      at: string,
      by: string,
      scope: "shared" | "person",
      v: string | number | boolean | null,
      byName?: string
    ) => ({
      id,
      at,
      by,
      ...(byName ? { byName } : {}),
      optionId: "o1",
      plugin: scope === "person" ? "org.decisionator.option-status" : "org.example.budget",
      key: scope === "person" ? "seen" : "cost",
      scope,
      value: v,
    });

    await copyEntriesAsAuthors(
      store,
      { store: "test", id: "p1" },
      {
        grades: [],
        comments: [],
        rankings: [],
        outcomes: [],
        properties: [
          value("p1", "2026-10-06T00:00:02Z", "guest:ana", "person", "seen_auto", "Ana"),
          value("p2", "2026-10-06T00:00:01Z", "me@example.com", "person", null),
          value("p3", "2026-10-06T00:00:03Z", "bob@example.com", "shared", 1200),
          value("p4", "2026-10-06T00:00:00Z", "me@example.com", "shared", false),
        ],
      }
    );

    const entry = (scope: "shared" | "person", v: string | number | boolean | null) => ({
      kind: "property",
      optionId: "o1",
      plugin: scope === "person" ? "org.decisionator.option-status" : "org.example.budget",
      key: scope === "person" ? "seen" : "cost",
      scope,
      value: v,
    });
    // Oldest first; shared values by the signed-in user whoever set them.
    expect(calls).toEqual([
      { entries: [entry("shared", false), entry("person", null)] },
      {
        entries: [entry("person", "seen_auto")],
        opts: { onBehalfOf: { participantId: "guest:ana", displayName: "Ana" } },
      },
      { entries: [entry("shared", 1200)] },
    ]);
  });

  it("replays history, effective entries and resets in their original order", async () => {
    const { store, calls } = recordingStore("me@example.com");
    const t = (n: number) => `2026-10-06T00:00:0${n}.000Z`;
    const seen = { optionId: "o1", plugin: "org.decisionator.option-status", key: "seen" };

    await copyEntriesAsAuthors(
      store,
      { store: "test", id: "p1" },
      {
        grades: [
          { id: "g3", at: t(3), by: "me@example.com", optionId: "o1", value: 4 },
          { id: "g7", at: t(7), by: "guest:ana", byName: "Ana", optionId: "o1", value: 1 },
        ],
        comments: [],
        rankings: [],
        outcomes: [],
        properties: [
          { id: "p8", at: t(8), by: "guest:ana", ...seen, scope: "person", value: "seen" },
        ],
        history: {
          grades: [
            { id: "g1", at: t(1), by: "me@example.com", optionId: "o1", value: 2 },
            { id: "g2", at: t(2), by: "guest:ana", byName: "Ana", optionId: "o1", value: 5 },
          ],
          rankings: [],
          properties: [
            { id: "p4", at: t(4), by: "guest:ana", ...seen, scope: "person", value: "seen_auto" },
          ],
        },
        resets: [
          {
            id: "x5",
            at: t(5),
            by: "me@example.com",
            scope: "participant",
            participantId: "guest:ana",
            targets: ["grades"],
          },
          {
            id: "x6",
            at: t(6),
            by: "guest:ana",
            byName: "Ana",
            scope: "participant",
            participantId: "guest:ana",
            targets: ["properties"],
            plugin: seen.plugin,
            key: seen.key,
          },
        ],
      }
    );

    const ana = { onBehalfOf: { participantId: "guest:ana", displayName: "Ana" } };
    expect(calls).toEqual([
      { entries: [{ kind: "grade", optionId: "o1", value: 2 }] },
      { entries: [{ kind: "grade", optionId: "o1", value: 5 }], opts: ana },
      { entries: [{ kind: "grade", optionId: "o1", value: 4 }] },
      {
        entries: [{ kind: "property", ...seen, scope: "person", value: "seen_auto" }],
        opts: ana,
      },
      // The owner's reset of Ana's grades is the owner's.
      {
        entries: [
          { kind: "reset", scope: "participant", participantId: "guest:ana", targets: ["grades"] },
        ],
      },
      // Ana's reset of her own seen marks stays hers, and starts its own call.
      {
        entries: [
          {
            kind: "reset",
            scope: "participant",
            participantId: "guest:ana",
            targets: ["properties"],
            plugin: seen.plugin,
            key: seen.key,
          },
          { kind: "grade", optionId: "o1", value: 1 },
          { kind: "property", ...seen, scope: "person", value: "seen" },
        ],
        opts: ana,
      },
    ]);
  });

  it("takes resets from a snapshot's history", async () => {
    const { store, calls } = recordingStore("me@example.com");
    const reset = {
      id: "x1",
      at: "2026-10-06T00:00:01.000Z",
      by: "owner@old-device",
      scope: "all" as const,
      targets: ["ballots" as const],
      round: 2,
    };
    await copyEntriesAsAuthors(
      store,
      { store: "test", id: "p1" },
      {
        grades: [],
        comments: [],
        rankings: [],
        outcomes: [],
        history: { grades: [], rankings: [], properties: [], resets: [reset] },
      }
    );
    // Not a self property reset: recorded by the signed-in owner.
    expect(calls).toEqual([
      { entries: [{ kind: "reset", scope: "all", targets: ["ballots"], round: 2 }] },
    ]);
  });
});
