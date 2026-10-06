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

async function startHost(project = new FakeProject(), role?: "contribute" | "view") {
  const host = new LiveShareHost({ project, role });
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
