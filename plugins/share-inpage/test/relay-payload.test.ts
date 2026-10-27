import { afterEach, describe, expect, it } from "vitest";
import { deriveHostKeyPair } from "../src/crypto.js";
import { LiveShareGuest, type LiveShareGuestOptions } from "../src/guest.js";
import { LiveShareHost } from "../src/host.js";
import type { RelayPayload } from "../src/nostr.js";
import { parseRelayPayload } from "../src/protocol.js";
import { FakeProject, baseSnapshot, connectPair, until } from "./fixtures.js";

const SESSION = "relay-sess";
const HOST = deriveHostKeyPair("relay-secret-for-tests-0123456789", SESSION);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function guestFor(dial: LiveShareGuestOptions["dial"], hostKey: string | null = HOST.hostKey) {
  const guest = new LiveShareGuest({
    sessionId: SESSION,
    deviceSecret: "device-secret-0123456789abcdef",
    displayName: "Ann",
    ...(hostKey ? { hostKey } : {}),
    dial,
    giveUpAfterMs: 200,
  });
  cleanups.push(() => guest.leave());
  return guest;
}

const offlineDial: LiveShareGuestOptions["dial"] = async () => {
  throw new Error("offline");
};

const valid = (): RelayPayload => ({
  v: 1,
  type: "snapshot",
  rev: 3,
  publishedAt: Date.now(),
  snapshot: baseSnapshot() as unknown as Record<string, unknown>,
});

describe("relay payload validation", () => {
  it("accepts well-formed snapshots and tombstones", () => {
    expect(parseRelayPayload(valid())?.type).toBe("snapshot");
    expect(
      parseRelayPayload({ v: 1, type: "tombstone", publishedAt: 1, reason: "revoked" })?.type
    ).toBe("tombstone");
  });

  it("rejects payloads whose snapshot is not a project snapshot", () => {
    expect(parseRelayPayload({ ...valid(), snapshot: { foo: 1 } })).toBeNull();
    expect(
      parseRelayPayload({ ...valid(), snapshot: { ...baseSnapshot(), options: "nope" } })
    ).toBeNull();
    expect(parseRelayPayload({ ...valid(), rev: "3" })).toBeNull();
    expect(parseRelayPayload({ v: 1, type: "tombstone", publishedAt: 1, reason: "x" })).toBeNull();
    expect(parseRelayPayload("not an object")).toBeNull();
  });

  it("guest ignores a malformed relay snapshot and applies a valid one", () => {
    const guest = guestFor(offlineDial);
    guest.applyRelayPayload(
      { ...valid(), snapshot: { project: 1 } } as unknown as RelayPayload,
      HOST.hostKey
    );
    expect(guest.getState().snapshot).toBeNull();
    guest.applyRelayPayload(valid(), HOST.hostKey);
    expect(guest.getState().snapshot?.project.title).toBe("Lunch");
    expect(guest.getState().rev).toBe(3);
  });
});

describe("host key pinning (link only, no trust on first use)", () => {
  it("does not learn a host key from a relay record", () => {
    const guest = guestFor(offlineDial, null);
    expect(guest.getState().hostKey).toBeUndefined();
    guest.applyRelayPayload(valid(), HOST.hostKey);
    expect(guest.getState().hostKey).toBeUndefined();
    expect(guest.getState().snapshot).toBeNull();
  });

  it("ignores relay records signed by a key other than the link's", () => {
    const guest = guestFor(offlineDial);
    const other = deriveHostKeyPair("another-relay-secret-0123456789", SESSION);
    guest.applyRelayPayload(valid(), other.hostKey);
    expect(guest.getState().snapshot).toBeNull();
  });

  it("does not learn a host key from the welcome snapshot", async () => {
    const host = new LiveShareHost({
      project: new FakeProject(),
      relaySecret: "relay-secret-for-tests-0123456789",
      sessionId: SESSION,
    });
    await host.start();
    cleanups.push(() => host.close());
    const guest = guestFor(async () => connectPair((l) => host.accept(l)), null);
    guest.start();
    await until(() => guest.getState().status === "live");
    expect(guest.getState().hostKey).toBeUndefined();
  });

  it("treats an 'ended' tombstone as ended (not revoked) and ignores it while live", async () => {
    const guest = guestFor(offlineDial);
    guest.applyRelayPayload(
      { v: 1, type: "tombstone", publishedAt: Date.now(), reason: "ended" },
      HOST.hostKey
    );
    expect(guest.getState().status).toBe("ended");

    const host = new LiveShareHost({ project: new FakeProject() });
    await host.start();
    cleanups.push(() => host.close());
    const live = guestFor(async () => connectPair((l) => host.accept(l)));
    live.start();
    await until(() => live.getState().status === "live");
    live.applyRelayPayload(
      { v: 1, type: "tombstone", publishedAt: Date.now(), reason: "ended" },
      HOST.hostKey
    );
    expect(live.getState().status).toBe("live");
  });

  it("keeps the key from the link and reports it", () => {
    const guest = new LiveShareGuest({
      sessionId: SESSION,
      deviceSecret: "device-secret-0123456789abcdef",
      displayName: "Ann",
      hostKey: HOST.hostKey,
      dial: offlineDial,
    });
    cleanups.push(() => guest.leave());
    expect(guest.getState().hostKey).toBe(HOST.hostKey);
  });
});
