import { afterEach, describe, expect, it } from "vitest";
import { guestSessionKey, participantIdFromKey } from "../src/crypto.js";
import { LiveShareGuest, SubmitError } from "../src/guest.js";
import { LiveShareHost } from "../src/host.js";
import type { Link } from "../src/link.js";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import { FakeProject, OWNER, baseSnapshot, connectPair, flush, until } from "./fixtures.js";

const SESSION = "sess1";
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function startHost(
  project = new FakeProject(),
  role?: "contribute" | "view",
  maxLinks?: number
) {
  const host = new LiveShareHost({ project, role, maxLinks });
  await host.start();
  cleanups.push(() => host.close());
  return { host, project };
}

/** A guest whose dial() opens an in-memory link to `host`; `links` exposes each guest end. */
function makeGuest(host: LiveShareHost, name: string, deviceSecret = `device-${name}`) {
  const links: Link[] = [];
  const guest = new LiveShareGuest({
    sessionId: SESSION,
    deviceSecret,
    displayName: name,
    dial: async () => {
      const link = connectPair((l) => host.accept(l));
      links.push(link);
      return link;
    },
    maxRetryDelayMs: 20,
    giveUpAfterMs: 500,
  });
  cleanups.push(() => guest.leave());
  return { guest, links };
}

async function joined(guest: LiveShareGuest) {
  guest.start();
  await until(() => guest.getState().status === "live");
  return guest;
}

describe("LiveShareHost + LiveShareGuest", () => {
  it("attributes guest grades to each guest without touching the owner's grade", async () => {
    const { host, project } = await startHost();
    await project.ownerAppend([{ kind: "grade", optionId: "a", value: 5 }]);

    const alice = await joined(makeGuest(host, "Alice").guest);
    const bob = await joined(makeGuest(host, "Bob").guest);
    await alice.submit([{ kind: "grade", optionId: "a", value: 2 }]);
    await bob.submit([{ kind: "grade", optionId: "a", value: 3 }]);

    const grades = project.state.grades.filter((g) => g.optionId === "a");
    expect(grades.map((g) => [g.by, g.value]).sort()).toEqual(
      [
        [OWNER, 5],
        [alice.getState().participantId, 2],
        [bob.getState().participantId, 3],
      ].sort()
    );
    expect(project.appendCalls[0]?.participant.displayName).toBe("Alice");
  });

  it("shows a guest their own grade after the host broadcasts the update", async () => {
    const { host } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    await alice.submit([{ kind: "grade", optionId: "b", value: 4 }]);
    await until(() => (alice.getState().snapshot?.grades.length ?? 0) > 0);
    const mine = alice
      .getState()
      .snapshot?.grades.find((g) => g.by === alice.getState().participantId && g.optionId === "b");
    expect(mine?.value).toBe(4);
  });

  it("gives a guest the same identity when they rejoin, and a different one per session", () => {
    const k1 = guestSessionKey("device", "s1");
    expect(participantIdFromKey(k1)).toBe(participantIdFromKey(guestSessionKey("device", "s1")));
    expect(participantIdFromKey(k1)).not.toBe(
      participantIdFromKey(guestSessionKey("device", "s2"))
    );
    expect(participantIdFromKey(k1)).not.toBe(
      participantIdFromKey(guestSessionKey("other-device", "s1"))
    );
  });

  it("gives guests with the same name distinct names, kept across a reconnect", async () => {
    const { host, project } = await startHost();
    const first = await joined(makeGuest(host, "Gina", "device-1").guest);
    const second = makeGuest(host, "gina ", "device-2");
    await joined(second.guest);

    expect(first.getState().name).toBe("Gina");
    expect(second.guest.getState().name).toBe("gina 2");
    expect(
      host
        .getState()
        .guests.map((g) => g.name)
        .sort()
    ).toEqual(["Gina", "gina 2"]);

    await second.guest.submit([{ kind: "grade", optionId: "a", value: 4 }]);
    expect(project.appendCalls.at(-1)?.participant.displayName).toBe("gina 2");

    second.links[0]?.close("network blip");
    await until(() => second.links.length === 2 && second.guest.getState().status === "live");
    expect(second.guest.getState().name).toBe("gina 2");
  });

  it("picks the lowest free number for a repeated name", async () => {
    const { host } = await startHost();
    await joined(makeGuest(host, "Gina", "device-1").guest);
    const two = makeGuest(host, "Gina", "device-2");
    await joined(two.guest);
    const three = await joined(makeGuest(host, "Gina", "device-3").guest);
    expect(three.getState().name).toBe("Gina 3");

    two.guest.leave();
    await until(() => host.getState().guests.length === 2);
    const four = await joined(makeGuest(host, "Gina", "device-4").guest);
    expect(four.getState().name).toBe("Gina 2");
  });

  it("serializes concurrent submissions so none are lost", async () => {
    const { host, project } = await startHost();
    const guests = await Promise.all(
      Array.from({ length: 12 }, (_, i) => joined(makeGuest(host, `G${i}`).guest))
    );
    await Promise.all(guests.map((g) => g.submit([{ kind: "grade", optionId: "c", value: 1 }])));
    expect(project.state.grades.filter((g) => g.optionId === "c")).toHaveLength(12);
  });

  it("rejects ballots while voting is closed and for a stale round", async () => {
    const project = new FakeProject(
      baseSnapshot({
        project: {
          ...baseSnapshot().project,
          voting: { state: "closed", round: 2, topN: 3, liveResults: true },
        },
      })
    );
    const { host } = await startHost(project);
    const alice = await joined(makeGuest(host, "Alice").guest);
    await expect(
      alice.submit([{ kind: "ranking", ranking: ["a"], round: 2 }])
    ).rejects.toMatchObject({ code: "voting_closed" });

    project.ownerSetVoting({ state: "open", round: 2, topN: 3, liveResults: true });
    await expect(
      alice.submit([{ kind: "ranking", ranking: ["a"], round: 1 }])
    ).rejects.toMatchObject({ code: "voting_closed" });
    await alice.submit([{ kind: "ranking", ranking: ["b", "a"], round: 2 }]);
    expect(project.state.rankings).toHaveLength(1);
  });

  it("accepts grades and comments while voting is closed", async () => {
    const project = new FakeProject(
      baseSnapshot({
        project: {
          ...baseSnapshot().project,
          voting: { state: "closed", round: 1, topN: 3, liveResults: true },
        },
      })
    );
    const { host } = await startHost(project);
    const alice = await joined(makeGuest(host, "Alice").guest);
    await alice.submit([{ kind: "grade", optionId: "a", value: 4 }]);
    await alice.submit([{ kind: "comment", optionId: "a", body: "Still good" }]);
    expect(project.state.grades).toHaveLength(1);
    expect(project.state.comments.map((c) => c.body)).toEqual(["Still good"]);
  });

  it("turns away guests beyond the link limit", async () => {
    const { host } = await startHost(new FakeProject(), "contribute", 2);
    await joined(makeGuest(host, "Alice").guest);
    await joined(makeGuest(host, "Bob").guest);
    const carol = makeGuest(host, "Carol").guest;
    carol.start();
    await until(() => carol.getState().status === "failed");
    expect(carol.getState().message).toBe("This session is full.");
    expect(host.getState().guests).toHaveLength(2);
  });

  it("rejects removed options, over-long ballots and edits of someone else's comment", async () => {
    const project = new FakeProject();
    const { host } = await startHost(project);
    await project.ownerAppend([{ kind: "comment", optionId: "a", body: "owner note" }]);
    const ownerComment = project.state.comments[0]?.id ?? "";
    const alice = await joined(makeGuest(host, "Alice").guest);

    await expect(
      alice.submit([{ kind: "grade", optionId: "gone", value: 3 }])
    ).rejects.toBeInstanceOf(SubmitError);
    await expect(
      alice.submit([{ kind: "ranking", ranking: ["a", "b", "c", "a"], round: 1 }])
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      alice.submit([{ kind: "comment", optionId: "a", body: "hijack", replaces: ownerComment }])
    ).rejects.toMatchObject({ code: "invalid" });
    expect(project.appendCalls).toHaveLength(0);
  });

  it("refuses every submission in a view-only session", async () => {
    const { host, project } = await startHost(new FakeProject(), "view");
    const alice = await joined(makeGuest(host, "Alice").guest);
    expect(alice.getState().role).toBe("view");
    await expect(alice.submit([{ kind: "grade", optionId: "a", value: 3 }])).rejects.toMatchObject({
      code: "read_only",
    });
    expect(project.appendCalls).toHaveLength(0);
  });

  it("reports a store failure to the guest instead of claiming success", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    project.failNext = new Error("Disk full");
    await expect(alice.submit([{ kind: "grade", optionId: "a", value: 3 }])).rejects.toMatchObject({
      code: "store_failed",
      message: "Disk full",
    });
  });

  it("redacts what guests see", async () => {
    const project = new FakeProject(
      baseSnapshot({
        project: {
          ...baseSnapshot().project,
          voting: { state: "open", round: 1, topN: 3, liveResults: false },
        },
        comments: [
          { id: "c1", at: "t", by: OWNER, optionId: "a", body: "secret", hidden: true },
          { id: "c2", at: "t", by: OWNER, optionId: "a", body: "visible" },
        ],
        rankings: [{ id: "r1", at: "t", by: OWNER, round: 1, ranking: ["a"] }],
        contributions: [
          {
            id: "k1",
            at: "t",
            by: OWNER,
            targetKind: "project",
            targetId: "p",
            type: "note",
            body: "draft",
            author: { kind: "agent", name: "bot" },
            reviewStatus: "pending",
          } as never,
        ],
      })
    );
    const { host } = await startHost(project);
    const alice = await joined(makeGuest(host, "Alice").guest);
    await alice.submit([{ kind: "ranking", ranking: ["b"], round: 1 }]);
    await until(() => (alice.getState().snapshot?.rankings.length ?? 0) > 0);

    const seen = alice.getState().snapshot;
    expect(seen?.role).toBe("contribute");
    expect(seen?.contributions).toEqual([]);
    expect(seen?.options.map((o) => o.id)).not.toContain("gone");
    expect(seen?.comments.find((c) => c.id === "c1")?.body).toBe("");
    expect(seen?.comments.find((c) => c.id === "c2")?.body).toBe("visible");
    expect(seen?.rankings.map((r) => r.by)).toEqual([alice.getState().participantId]);
  });

  it("keeps the roster accurate as guests come and go", async () => {
    const { host } = await startHost();
    const states: number[] = [];
    host.subscribe((s) => states.push(s.guests.length));
    const alice = makeGuest(host, "Alice");
    await joined(alice.guest);
    const bob = makeGuest(host, "Bob");
    await joined(bob.guest);
    expect(
      host
        .getState()
        .guests.map((g) => g.name)
        .sort()
    ).toEqual(["Alice", "Bob"]);

    bob.guest.leave();
    await until(() => host.getState().guests.length === 1);
    expect(host.getState().guests[0]?.name).toBe("Alice");
  });

  it("tells guests when the host ends the session and keeps their last view", async () => {
    const { host } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    host.close("Thanks, we're done");
    await until(() => alice.getState().status === "ended");
    expect(alice.getState().message).toBe("Thanks, we're done");
    expect(alice.getState().snapshot?.project.title).toBe("Lunch");
    await expect(alice.submit([{ kind: "grade", optionId: "a", value: 1 }])).rejects.toMatchObject({
      code: "offline",
    });
  });

  it("reconnects after the link drops and fails the submission that was in flight", async () => {
    const { host, project } = await startHost();
    const { guest, links } = makeGuest(host, "Alice");
    await joined(guest);
    const firstId = guest.getState().participantId;

    project.state.grades = [];
    const inFlight = guest.submit([{ kind: "grade", optionId: "a", value: 2 }]);
    links[0]?.close("network blip");
    await expect(inFlight).rejects.toMatchObject({ code: "offline" });
    expect(["reconnecting", "live"]).toContain(guest.getState().status);

    await until(() => guest.getState().status === "live");
    expect(links).toHaveLength(2);
    expect(guest.getState().participantId).toBe(firstId);
    await guest.submit([{ kind: "grade", optionId: "a", value: 4 }]);
  });

  it("gives up after the retry window when the host never answers", async () => {
    const guest = new LiveShareGuest({
      sessionId: SESSION,
      deviceSecret: "d",
      displayName: "Alice",
      dial: async () => {
        throw new Error("unreachable");
      },
      maxRetryDelayMs: 10,
      giveUpAfterMs: 60,
    });
    cleanups.push(() => guest.leave());
    guest.start();
    await until(() => guest.getState().status === "failed");
    expect(guest.getState().message).toMatch(/Could not reach the host/);
  });

  it("says the host is no longer reachable when it vanishes mid-session", async () => {
    const { host } = await startHost();
    let reachable = true;
    const links: Link[] = [];
    const guest = new LiveShareGuest({
      sessionId: SESSION,
      deviceSecret: "d",
      displayName: "Alice",
      dial: async () => {
        if (!reachable) throw new Error("unreachable");
        const link = connectPair((l) => host.accept(l));
        links.push(link);
        return link;
      },
      maxRetryDelayMs: 10,
      giveUpAfterMs: 60,
    });
    cleanups.push(() => guest.leave());
    await joined(guest);

    // The host tab disappears without sending `closing`.
    reachable = false;
    links[0]?.close("tab gone");
    await until(() => guest.getState().status === "failed");
    expect(guest.getState().message).toBe("The host is no longer reachable.");
    expect(guest.getState().snapshot?.project.title).toBe("Lunch");
  });

  it("turns away a guest speaking another protocol version", async () => {
    const { host } = await startHost();
    const link = connectPair((l) => host.accept(l));
    const got: unknown[] = [];
    link.onMessage((m) => got.push(m));
    link.send({ t: "hello", proto: PROTOCOL_VERSION + 1, key: "k".repeat(64), name: "Old" });
    await flush();
    expect(got[0]).toMatchObject({ t: "error", code: "protocol_mismatch" });
    expect(link.closed).toBe(true);
  });

  it("rate-limits a guest flooding the host", async () => {
    const { host } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => alice.submit([{ kind: "grade", optionId: "a", value: 3 }]))
    );
    const limited = results.filter(
      (r) => r.status === "rejected" && (r.reason as SubmitError).code === "rate_limited"
    );
    expect(limited.length).toBeGreaterThan(0);
  });
});

describe("option properties over live share (proto 3)", () => {
  const STATUS = { plugin: "status-personal", key: "status" } as const;

  it("records a guest's person-scoped property under the guest", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    await alice.submit([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "seen" },
    ]);

    expect(project.appendCalls).toHaveLength(1);
    expect(project.appendCalls[0]?.participant).toMatchObject({
      participantId: alice.getState().participantId,
      displayName: "Alice",
    });
    expect(project.appendCalls[0]?.entries).toEqual([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "seen" },
    ]);
    expect(project.state.properties).toMatchObject([
      { by: alice.getState().participantId, optionId: "a", scope: "person", value: "seen" },
    ]);

    // Latest wins per guest and option.
    await alice.submit([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "done" },
    ]);
    expect(project.state.properties?.map((p) => p.value)).toEqual(["done"]);
  });

  it("refuses shared properties, removed options and oversized values", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);

    await expect(
      alice.submit([{ kind: "property", optionId: "a", ...STATUS, scope: "shared", value: "x" }])
    ).rejects.toMatchObject({ code: "invalid", message: "That change is not allowed." });
    await expect(
      alice.submit([
        { kind: "property", optionId: "gone", ...STATUS, scope: "person", value: "seen" },
      ])
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      alice.submit([
        { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "x".repeat(2100) },
      ])
    ).rejects.toMatchObject({ code: "invalid" });
    expect(project.appendCalls).toHaveLength(0);
  });

  it("shows each guest shared values and only their own person values", async () => {
    const project = new FakeProject();
    const { host } = await startHost(project);
    await project.ownerAppend([
      { kind: "property", optionId: "a", plugin: "cost", key: "eur", scope: "shared", value: 12 },
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "owner-private" },
    ]);
    const alice = await joined(makeGuest(host, "Alice").guest);
    const bob = await joined(makeGuest(host, "Bob").guest);
    await alice.submit([
      { kind: "property", optionId: "b", ...STATUS, scope: "person", value: "alice-private" },
    ]);
    await bob.submit([
      { kind: "property", optionId: "c", ...STATUS, scope: "person", value: "bob-mark" },
    ]);
    await until(() => (bob.getState().snapshot?.properties?.length ?? 0) >= 2);
    await until(() => (alice.getState().snapshot?.properties?.length ?? 0) >= 2);

    const bobSees = bob.getState().snapshot?.properties?.map((p) => p.value);
    expect(bobSees?.sort()).toEqual([12, "bob-mark"].sort());
    const aliceSees = alice.getState().snapshot?.properties?.map((p) => p.value);
    expect(aliceSees?.sort()).toEqual([12, "alice-private"].sort());
    for (const seen of [bobSees, aliceSees]) expect(seen).not.toContain("owner-private");
  });

  it("turns away a guest speaking protocol 2", async () => {
    expect(PROTOCOL_VERSION).toBe(3);
    const { host } = await startHost();
    const link = connectPair((l) => host.accept(l));
    const got: unknown[] = [];
    link.onMessage((m) => got.push(m));
    link.send({ t: "hello", proto: 2, key: "k".repeat(64), name: "Old" });
    await flush();
    expect(got[0]).toMatchObject({ t: "error", code: "protocol_mismatch" });
  });
});

describe("resets and history over live share (proto 3)", () => {
  const STATUS = { plugin: "status-personal", key: "status" } as const;

  it("lets a guest clear their own person values, and only theirs", async () => {
    const { host, project } = await startHost();
    await project.ownerAppend([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "owner-mark" },
    ]);
    const alice = await joined(makeGuest(host, "Alice").guest);
    const bob = await joined(makeGuest(host, "Bob").guest);
    const aliceId = alice.getState().participantId;
    const bobId = bob.getState().participantId;
    await alice.submit([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "seen" },
      { kind: "property", optionId: "b", ...STATUS, scope: "person", value: "done" },
    ]);
    await bob.submit([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "bob-mark" },
    ]);

    await alice.submit([
      { kind: "reset", scope: "participant", targets: ["properties"], ...STATUS },
    ]);

    expect(project.appendCalls.at(-1)?.entries).toEqual([
      {
        kind: "reset",
        scope: "participant",
        participantId: aliceId,
        targets: ["properties"],
        ...STATUS,
      },
    ]);
    expect(project.state.properties?.map((p) => [p.by, p.value]).sort()).toEqual(
      [
        [OWNER, "owner-mark"],
        [bobId, "bob-mark"],
      ].sort()
    );
    expect(project.state.history?.properties.map((p) => p.value).sort()).toEqual(["done", "seen"]);
    await until(
      () =>
        (alice.getState().snapshot?.properties ?? []).length === 0 &&
        (alice.getState().snapshot?.history?.resets.length ?? 0) === 1
    );
  });

  it("refuses any other guest reset", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    const refused = [
      { kind: "reset", scope: "all", targets: ["properties"], ...STATUS },
      { kind: "reset", scope: "participant", targets: ["grades"], ...STATUS },
      { kind: "reset", scope: "participant", targets: ["properties", "ballots"], ...STATUS },
      { kind: "reset", scope: "participant", targets: ["properties"] },
    ] as const;
    for (const entry of refused) {
      await expect(alice.submit([entry as never])).rejects.toMatchObject({
        code: "invalid",
        message: "That change is not allowed.",
      });
    }
    expect(project.appendCalls).toHaveLength(0);
  });

  it("records a guest reset for the guest even if the guest names someone else", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    await alice.submit([
      {
        kind: "reset",
        scope: "participant",
        participantId: OWNER,
        targets: ["properties"],
        ...STATUS,
      } as never,
    ]);
    expect(project.appendCalls[0]?.entries[0]).toMatchObject({
      participantId: alice.getState().participantId,
    });
  });

  it("delivers an owner reset to the guest, whose grade disappears", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    const aliceId = alice.getState().participantId ?? "";
    await alice.submit([{ kind: "grade", optionId: "a", value: 4 }]);
    await until(() => (alice.getState().snapshot?.grades.length ?? 0) === 1);

    await project.ownerAppend([
      { kind: "reset", scope: "participant", participantId: aliceId, targets: ["grades"] },
    ]);
    await until(() => (alice.getState().snapshot?.grades.length ?? 0) === 0);
    const history = alice.getState().snapshot?.history;
    expect(history?.grades.map((g) => g.value)).toEqual([4]);
    expect(history?.resets.map((r) => r.participantId)).toEqual([aliceId]);
  });

  it("shows a guest only their own history and the resets that concern them", async () => {
    const { host, project } = await startHost();
    const alice = await joined(makeGuest(host, "Alice").guest);
    const bob = await joined(makeGuest(host, "Bob").guest);
    const aliceId = alice.getState().participantId ?? "";
    const bobId = bob.getState().participantId ?? "";
    await project.ownerAppend([{ kind: "grade", optionId: "a", value: 5 }]);
    await project.ownerAppend([{ kind: "grade", optionId: "a", value: 1 }]);
    await alice.submit([{ kind: "grade", optionId: "a", value: 2 }]);
    await alice.submit([{ kind: "grade", optionId: "a", value: 3 }]);
    await bob.submit([{ kind: "grade", optionId: "b", value: 2 }]);
    await bob.submit([{ kind: "grade", optionId: "b", value: 4 }]);
    await bob.submit([
      { kind: "property", optionId: "a", ...STATUS, scope: "person", value: "bob-mark" },
    ]);
    await bob.submit([{ kind: "reset", scope: "participant", targets: ["properties"], ...STATUS }]);
    await project.ownerAppend([
      { kind: "reset", scope: "participant", participantId: bobId, targets: ["grades"] },
      { kind: "reset", scope: "all", targets: ["ballots"] },
    ]);

    // The owner's store keeps everything.
    expect(project.state.history?.grades.map((g) => g.by).sort()).toEqual(
      [OWNER, aliceId, bobId, bobId].sort()
    );
    expect(project.state.history?.resets).toHaveLength(3);

    await until(() => (alice.getState().snapshot?.history?.resets.length ?? 0) === 1);
    await until(() => (bob.getState().snapshot?.history?.resets.length ?? 0) === 3);
    const aliceHistory = alice.getState().snapshot?.history;
    expect(aliceHistory?.grades.map((g) => [g.by, g.value])).toEqual([[aliceId, 2]]);
    expect(aliceHistory?.rankings).toEqual([]);
    expect(aliceHistory?.properties).toEqual([]);
    expect(aliceHistory?.resets.map((r) => r.scope)).toEqual(["all"]);

    const bobHistory = bob.getState().snapshot?.history;
    expect(bobHistory?.grades.every((g) => g.by === bobId)).toBe(true);
    expect(bobHistory?.grades.map((g) => g.value)).toEqual([2, 4]);
    expect(bobHistory?.properties.map((p) => p.value)).toEqual(["bob-mark"]);
    expect(bobHistory?.resets.map((r) => r.scope).sort()).toEqual([
      "all",
      "participant",
      "participant",
    ]);
  });
});
