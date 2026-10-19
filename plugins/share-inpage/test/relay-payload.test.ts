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

function guestFor(dial: LiveShareGuestOptions["dial"]) {
  const guest = new LiveShareGuest({
    sessionId: SESSION,
    deviceSecret: "device-secret-0123456789abcdef",
    displayName: "Ann",
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

describe("host key pinning (TOFU)", () => {
  it("exposes the host key learned from a relay record", () => {
    const guest = guestFor(offlineDial);
    expect(guest.getState().hostKey).toBeUndefined();
    guest.applyRelayPayload(valid(), HOST.hostKey);
    expect(guest.getState().hostKey).toBe(HOST.hostKey);
  });

  it("exposes the host key learned from the welcome snapshot", async () => {
    const host = new LiveShareHost({
      project: new FakeProject(),
      relaySecret: "relay-secret-for-tests-0123456789",
      sessionId: SESSION,
    });
    await host.start();
    cleanups.push(() => host.close());
    const guest = guestFor(async () => connectPair((l) => host.accept(l)));
    guest.start();
    await until(() => guest.getState().status === "live");
    expect(guest.getState().hostKey).toBe(HOST.hostKey);
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
