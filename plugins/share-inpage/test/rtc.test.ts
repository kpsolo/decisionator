import { afterEach, describe, expect, it } from "vitest";
import { createSessionCredentials, deriveHostKeyPair, deriveSessionKeys } from "../src/crypto.js";
import type { Link } from "../src/link.js";
import type { SignalEnvelope } from "../src/protocol.js";
import { dialHost, listenForGuests } from "../src/rtc.js";
import { SignalingRoom, createMemorySignalingHub } from "../src/signaling.js";
import { flush, until } from "./fixtures.js";

/** Just enough of RTCDataChannel for rtc.ts. */
class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  send() {}
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

/** Just enough of RTCPeerConnection for rtc.ts; ICE gathering finishes when `gathering` is false. */
class FakePc extends EventTarget {
  closed = false;
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState;
  localDescription: { type: string; sdp: string } | null = null;
  ondatachannel: ((e: { channel: FakeChannel }) => void) | null = null;
  channel: FakeChannel | null = null;

  constructor(gathering: boolean) {
    super();
    this.iceGatheringState = gathering ? "gathering" : "complete";
  }
  createDataChannel() {
    this.channel = new FakeChannel();
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0 answer" };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription() {}
  close() {
    this.closed = true;
  }
  /** The remote side opened its channel. */
  remoteChannelOpens(): FakeChannel {
    const channel = new FakeChannel();
    channel.readyState = "open";
    this.ondatachannel?.({ channel });
    return channel;
  }
}

function factory(gathering = false) {
  const pcs: FakePc[] = [];
  const createPeerConnection = () => {
    const pc = new FakePc(gathering);
    pcs.push(pc);
    return pc as unknown as RTCPeerConnection;
  };
  return { pcs, createPeerConnection };
}

function rooms() {
  const hub = createMemorySignalingHub();
  const keys = deriveSessionKeys(createSessionCredentials());
  const host = new SignalingRoom([hub()], keys);
  const guest = new SignalingRoom([hub()], keys);
  return { host, guest };
}

function offer(from: string): SignalEnvelope {
  return {
    v: 1,
    kind: "offer",
    from,
    nonce: `${from}-${Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
    sdp: "v=0 offer",
  };
}

const HOST = deriveHostKeyPair("relay-secret-for-rtc-tests-0123456789", "rtc-sess");
const signingKey = HOST.secretKey;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("rtc: host side", () => {
  it("closes the peer connection when a guest's channel closes from the remote side", async () => {
    const { host, guest } = rooms();
    const { pcs, createPeerConnection } = factory();
    const links: Link[] = [];
    const stop = listenForGuests(host, { iceServers: [], createPeerConnection, signingKey }, (l) =>
      links.push(l)
    );
    cleanups.push(
      stop,
      () => host.close(),
      () => guest.close()
    );

    guest.send(offer("g1"));
    await until(() => pcs.length === 1 && pcs[0]?.localDescription !== null);
    const pc = pcs[0] as FakePc;
    const channel = pc.remoteChannelOpens();
    await until(() => links.length === 1);

    channel.close(); // the guest went away
    await until(() => links[0]?.closed === true);
    expect(pc.closed).toBe(true);
  });

  it("caps connection attempts that have not opened yet", async () => {
    const { host, guest } = rooms();
    const { pcs, createPeerConnection } = factory();
    const stop = listenForGuests(
      host,
      { iceServers: [], createPeerConnection, signingKey, maxPendingConnections: 4 },
      () => {}
    );
    cleanups.push(
      stop,
      () => host.close(),
      () => guest.close()
    );

    for (let i = 0; i < 40; i++) guest.send(offer(`flood-${i}`));
    await flush(50);
    expect(pcs.length).toBe(4);

    // A slot frees up once an attempt opens, and the next offer gets through.
    (pcs[0] as FakePc).remoteChannelOpens();
    guest.send(offer("late"));
    await until(() => pcs.length === 5);
  });

  it("does not create a second connection for repeated offers from one guest", async () => {
    const { host, guest } = rooms();
    const { pcs, createPeerConnection } = factory();
    const stop = listenForGuests(
      host,
      { iceServers: [], createPeerConnection, signingKey },
      () => {}
    );
    cleanups.push(
      stop,
      () => host.close(),
      () => guest.close()
    );
    for (let i = 0; i < 10; i++) guest.send(offer("same"));
    await flush(50);
    expect(pcs.length).toBe(1);
  });
});

describe("rtc: guest side", () => {
  it("stops re-sending its offer when the dial is aborted during ICE gathering", async () => {
    const { host, guest } = rooms();
    const { pcs, createPeerConnection } = factory(true);
    cleanups.push(
      () => host.close(),
      () => guest.close()
    );
    const offers: SignalEnvelope[] = [];
    host.onEnvelope((env) => {
      if (env.kind === "offer") offers.push(env);
    });

    const abort = new AbortController();
    const dialing = dialHost(
      guest,
      {
        iceServers: [],
        createPeerConnection,
        hostKey: HOST.hostKey,
        gatherTimeoutMs: 40,
        resendMs: 10,
        timeoutMs: 5000,
      },
      abort.signal
    );
    await until(() => pcs.length === 1);
    abort.abort();
    await expect(dialing).rejects.toThrow("aborted");

    await flush(150); // gathering times out after the abort; nothing may be sent after that
    expect(offers).toHaveLength(0);
    expect(pcs[0]?.closed).toBe(true);
  });
});
