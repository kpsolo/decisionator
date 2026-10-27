import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type SessionCredentials,
  createSessionCredentials,
  deriveHostKeyPair,
  deriveSessionKeys,
  seal,
  unseal,
} from "../src/crypto.js";
import { NIP78_SNAPSHOT_KIND, type NostrEvent, NostrSignaling } from "../src/nostr.js";
import { publishTombstone, startHosting } from "../src/session.js";
import { FakeProject, flush, until } from "./fixtures.js";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(frame: string) {
    if (this.readyState !== 1) throw new Error("socket not open");
    this.sent.push(JSON.parse(frame));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** Events this socket sent, of one kind. */
  events(kind: number): NostrEvent[] {
    return this.sent
      .filter((f): f is ["EVENT", NostrEvent] => Array.isArray(f) && f[0] === "EVENT")
      .map((f) => f[1])
      .filter((e) => e.kind === kind);
  }
  ok(eventId: string, accepted = true) {
    this.onmessage?.({ data: JSON.stringify(["OK", eventId, accepted, ""]) });
  }
}

const createSocket = (url: string) => new FakeSocket(url) as unknown as WebSocket;

function hostCredentials(): SessionCredentials {
  return { ...createSessionCredentials(), relaySecret: "relay-secret-0123456789abcdef" };
}

function payloadOf(creds: SessionCredentials, event: NostrEvent): { type?: string } {
  const keys = deriveSessionKeys(creds);
  return JSON.parse(unseal(keys.signalKey, keys.topic, event.content) ?? "{}");
}

afterEach(() => {
  FakeSocket.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("relay tombstones", () => {
  it("dates a tombstone strictly after the last snapshot, even within the same second", () => {
    const creds = hostCredentials();
    const keys = deriveSessionKeys(creds);
    const { secretKey } = deriveHostKeyPair(creds.relaySecret as string, creds.sessionId);
    const nostr = new NostrSignaling(["wss://a"], createSocket);
    const snap = nostr.publishSnapshot(
      keys.topic,
      secretKey,
      seal(keys.signalKey, keys.topic, "s")
    );
    const next = nostr.publishSnapshot(
      keys.topic,
      secretKey,
      seal(keys.signalKey, keys.topic, "t")
    );
    expect(next.created_at).toBeGreaterThan(snap.created_at);
    nostr.close();
  });

  it("waits for relays to confirm the tombstone before closing the sockets", async () => {
    const creds = hostCredentials();
    const keys = deriveSessionKeys(creds);
    const { secretKey } = deriveHostKeyPair(creds.relaySecret as string, creds.sessionId);

    // An earlier snapshot published from this tab (e.g. while the session was live).
    const earlier = new NostrSignaling(["wss://a"], createSocket);
    const snapshot = earlier.publishSnapshot(
      keys.topic,
      secretKey,
      seal(keys.signalKey, keys.topic, "{}")
    );
    earlier.close();
    FakeSocket.instances = [];

    let done: boolean | undefined;
    const pending = publishTombstone({
      credentials: creds,
      relays: ["wss://a", "wss://b"],
      createSocket,
      timeoutMs: 2000,
    }).then((ok) => {
      done = ok;
    });
    const [a, b] = FakeSocket.instances as [FakeSocket, FakeSocket];
    await flush(20);
    expect(done).toBeUndefined();
    expect(a.readyState).toBe(0); // not closed while the tombstone is still queued

    a.open();
    b.open();
    const [tombstone] = a.events(NIP78_SNAPSHOT_KIND);
    if (!tombstone) throw new Error("no tombstone sent");
    expect(payloadOf(creds, tombstone).type).toBe("tombstone");
    expect(tombstone.created_at).toBeGreaterThan(snapshot.created_at);
    expect(tombstone.tags).toContainEqual(["d", keys.topic]);
    // NIP-09 deletion of the last snapshot, best effort.
    expect(a.events(5)[0]?.tags).toContainEqual(["e", snapshot.id]);

    a.ok(tombstone.id);
    await flush(20);
    expect(done).toBeUndefined(); // still waiting for the other relay
    b.ok(tombstone.id, false);
    await until(() => done !== undefined);
    expect(done).toBe(true);
    expect(a.readyState).toBe(3);
    expect(b.readyState).toBe(3);
  });

  it("gives up after the timeout and reports that no relay confirmed", async () => {
    const creds = hostCredentials();
    const ok = await publishTombstone({
      credentials: creds,
      relays: ["wss://a"],
      createSocket,
      timeoutMs: 50,
    });
    expect(ok).toBe(false);
    expect(FakeSocket.instances[0]?.readyState).toBe(3);
  });

  it("does nothing without a relay secret or relays", async () => {
    expect(
      await publishTombstone({ credentials: createSessionCredentials(), relays: ["wss://a"] })
    ).toBe(false);
    expect(await publishTombstone({ credentials: hostCredentials(), relays: [] })).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe("live revoke", () => {
  async function hostLive(creds: SessionCredentials) {
    vi.stubGlobal("RTCPeerConnection", class {});
    vi.stubGlobal("WebSocket", FakeSocket);
    const hosting = await startHosting({
      project: new FakeProject(),
      credentials: creds,
      config: { relays: ["wss://a"], iceServers: [], sameBrowser: false },
    });
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();
    return { hosting, socket };
  }

  it("publishes the tombstone and closes the relay sockets only after confirmation", async () => {
    const creds = hostCredentials();
    const { hosting, socket } = await hostLive(creds);
    let finished = false;
    const revoking = Promise.resolve(hosting.revoke("revoked", { purgeRelays: true })).then(() => {
      finished = true;
    });
    await until(() => socket.events(NIP78_SNAPSHOT_KIND).length > 0);
    const tombstone = socket
      .events(NIP78_SNAPSHOT_KIND)
      .find((e) => payloadOf(creds, e).type === "tombstone");
    if (!tombstone) throw new Error("no tombstone sent");
    await flush(20);
    expect(finished).toBe(false);
    expect(socket.readyState).toBe(1);
    socket.ok(tombstone.id);
    await revoking;
    expect(socket.readyState).toBe(3);
    expect(hosting.host.getState().status).toBe("closed");
  });

  it("close() publishes an 'ended' tombstone and deletes the last snapshot (F8)", async () => {
    const creds = hostCredentials();
    const keys = deriveSessionKeys(creds);
    const { hosting, socket } = await hostLive(creds);
    // A snapshot the live session published earlier from this tab.
    const { secretKey } = deriveHostKeyPair(creds.relaySecret as string, creds.sessionId);
    const earlier = new NostrSignaling(["wss://x"], createSocket);
    const snapshot = earlier.publishSnapshot(
      keys.topic,
      secretKey,
      seal(keys.signalKey, keys.topic, "{}")
    );
    earlier.close();

    hosting.close(); // synchronous: never waits for relays
    expect(hosting.host.getState().status).toBe("closed");
    const tombstone = socket
      .events(NIP78_SNAPSHOT_KIND)
      .find((e) => payloadOf(creds, e).type === "tombstone");
    if (!tombstone) throw new Error("no tombstone sent");
    expect(payloadOf(creds, tombstone)).toMatchObject({ type: "tombstone", reason: "ended" });
    expect(tombstone.created_at).toBeGreaterThan(snapshot.created_at);
    expect(socket.events(5)[0]?.tags).toContainEqual(["e", snapshot.id]);
    // The relay sockets stay open until a relay confirms (or the short timeout passes).
    expect(socket.readyState).toBe(1);
    socket.ok(tombstone.id);
    await until(() => socket.readyState === 3);
  });

  it("close() releases the relay sockets after the timeout even without confirmation", async () => {
    const creds = hostCredentials();
    vi.stubGlobal("RTCPeerConnection", class {});
    vi.stubGlobal("WebSocket", FakeSocket);
    const hosting = await startHosting({
      project: new FakeProject(),
      credentials: creds,
      config: { relays: ["wss://a"], iceServers: [], sameBrowser: false },
      endTombstoneTimeoutMs: 30,
    });
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();
    hosting.close("The host closed their tab.");
    await until(() => socket.readyState === 3);
  });

  it("refuses to host without the relay secret that signs answers", async () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    await expect(
      startHosting({
        project: new FakeProject(),
        credentials: createSessionCredentials(),
        config: { relays: [], iceServers: [], sameBrowser: false },
      })
    ).rejects.toThrow(/relay secret/);
  });

  it("leaves the relays alone when asked not to purge them", async () => {
    const creds = hostCredentials();
    const { hosting, socket } = await hostLive(creds);
    await hosting.revoke("revoked", { purgeRelays: false });
    const tombstones = socket
      .events(NIP78_SNAPSHOT_KIND)
      .filter((e) => payloadOf(creds, e).type === "tombstone");
    expect(tombstones).toHaveLength(0);
    expect(socket.readyState).toBe(3);
  });
});
