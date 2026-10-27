import { schnorr } from "@noble/curves/secp256k1";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionCredentials,
  deriveHostKeyPair,
  deriveSessionKeys,
  randomId,
  signAnswer,
} from "../src/crypto.js";
import { LiveShareGuest } from "../src/guest.js";
import type { SignalEnvelope } from "../src/protocol.js";
import { dialHost, listenForGuests } from "../src/rtc.js";
import { LiveShareLegacyLinkError, joinPath, joinSession } from "../src/session.js";
import { SignalingRoom, createMemorySignalingHub } from "../src/signaling.js";
import { flush, until } from "./fixtures.js";

/**
 * F1 (contract live-share v3.2.0): the host signs every signaling answer with its host key and the
 * guest accepts only answers that verify against the key in the join link, before it sends
 * anything (in particular its `hello` with the participant key).
 */

const SESSION = "auth-sess";
const HOST = deriveHostKeyPair("relay-secret-for-auth-tests-0123456789", SESSION);
const ATTACKER_KEY = schnorr.utils.randomPrivateKey();

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
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

/** Guest-side fake: the channel opens as soon as an answer is applied (to whoever sent it). */
class FakePc extends EventTarget {
  closed = false;
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string }[] = [];
  ondatachannel: ((e: { channel: FakeChannel }) => void) | null = null;
  channel: FakeChannel | null = null;
  constructor(private readonly answerSdp = "v=0 answer from host") {
    super();
  }
  createDataChannel() {
    this.channel = new FakeChannel();
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: `v=0 offer ${randomId(4)}` };
  }
  async createAnswer() {
    return { type: "answer", sdp: this.answerSdp };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remote.push(d);
    if (d.type === "answer") queueMicrotask(() => this.channel?.open());
  }
  close() {
    this.closed = true;
  }
}

function factory() {
  const pcs: FakePc[] = [];
  const createPeerConnection = () => {
    const pc = new FakePc();
    pcs.push(pc);
    return pc as unknown as RTCPeerConnection;
  };
  return { pcs, createPeerConnection };
}

function rooms() {
  const hub = createMemorySignalingHub();
  const keys = deriveSessionKeys({ sessionId: SESSION, secret: "secret-0123456789abcdef" });
  const make = () => new SignalingRoom([hub()], keys);
  return { host: make(), guest: make(), attacker: make() };
}

/** Another link holder racing the host: answers every offer with `forge(offer)`. */
function impostor(room: SignalingRoom, forge: (offer: SignalEnvelope) => SignalEnvelope) {
  const sent: SignalEnvelope[] = [];
  room.onEnvelope((env) => {
    if (env.kind !== "offer") return;
    const answer = forge(env);
    sent.push(answer);
    room.send(answer);
  });
  return sent;
}

function answerTo(
  offer: SignalEnvelope,
  key: Uint8Array | null,
  topic: string,
  patch: { offerSdp?: string; to?: string; sdp?: string } = {}
): SignalEnvelope {
  const env: SignalEnvelope = {
    v: 1,
    kind: "answer",
    from: "evil",
    to: patch.to ?? offer.from,
    nonce: randomId(12),
    ts: Date.now(),
    sdp: patch.sdp ?? "v=0 answer from impostor",
  };
  if (!key) return env;
  const sig = signAnswer(key, {
    topic,
    from: env.from,
    to: env.to as string,
    offerSdp: patch.offerSdp ?? offer.sdp,
    answerSdp: env.sdp,
    ts: env.ts,
    nonce: env.nonce,
  });
  return { ...env, sig };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  vi.unstubAllGlobals();
});

describe("host-authenticated signaling (F1)", () => {
  it("a guest ignores answers not signed by the link's host key and never sends hello", async () => {
    const r = rooms();
    cleanups.push(
      () => r.host.close(),
      () => r.guest.close(),
      () => r.attacker.close()
    );
    // The impostor answers every offer three ways: unsigned, signed with its own key, and with
    // a host signature lifted from another offer.
    let round = 0;
    const forged = impostor(r.attacker, (offer) => {
      round++;
      if (round % 3 === 1) return answerTo(offer, null, r.attacker.topic);
      if (round % 3 === 2) return answerTo(offer, ATTACKER_KEY, r.attacker.topic);
      return answerTo(offer, HOST.secretKey, r.attacker.topic, { offerSdp: "v=0 other offer" });
    });

    const { pcs, createPeerConnection } = factory();
    const guest = new LiveShareGuest({
      sessionId: SESSION,
      deviceSecret: "device-secret-0123456789abcdef",
      displayName: "Alice",
      hostKey: HOST.hostKey,
      dial: (signal) =>
        dialHost(
          r.guest,
          {
            iceServers: [],
            createPeerConnection,
            hostKey: HOST.hostKey,
            gatherTimeoutMs: 10,
            resendMs: 15,
            timeoutMs: 5_000,
          },
          signal
        ),
    });
    cleanups.push(() => guest.leave());
    guest.start();

    await until(() => forged.length >= 6);
    await flush(30);
    const pc = pcs[0] as FakePc;
    expect(pc.remote).toEqual([]); // no forged SDP was applied
    expect(pc.channel?.sent).toEqual([]); // so no hello (and no participant key) went anywhere
    expect(guest.getState().status).toBe("connecting");

    // The real host answers with a signature over this offer: now the guest connects and says hello.
    const host = factory();
    const stop = listenForGuests(
      r.host,
      {
        iceServers: [],
        createPeerConnection: host.createPeerConnection,
        signingKey: HOST.secretKey,
      },
      () => {}
    );
    cleanups.push(stop);
    await until(() => (pc.channel?.sent.length ?? 0) > 0);
    expect(pc.remote).toEqual([{ type: "answer", sdp: "v=0 answer from host" }]);
    const hello = JSON.parse((pc.channel?.sent[0] as string).slice(1));
    expect(hello).toMatchObject({ t: "hello", name: "Alice" });
  });

  it("rejects a host-signed answer re-addressed to another attempt", async () => {
    const r = rooms();
    cleanups.push(
      () => r.guest.close(),
      () => r.attacker.close()
    );
    const forged = impostor(r.attacker, (offer) => {
      // Signed by the host for attempt "someone-else", then re-addressed to this guest.
      const env = answerTo(offer, HOST.secretKey, r.attacker.topic, { to: "someone-else" });
      return { ...env, to: offer.from };
    });
    const { pcs, createPeerConnection } = factory();
    const dialing = dialHost(r.guest, {
      iceServers: [],
      createPeerConnection,
      hostKey: HOST.hostKey,
      gatherTimeoutMs: 10,
      resendMs: 15,
      timeoutMs: 200,
    });
    await expect(dialing).rejects.toThrow("host not reachable");
    expect(forged.length).toBeGreaterThan(0);
    expect(pcs[0]?.remote).toEqual([]);
  });

  it("accepts the host's answer bound to the topic, attempt and offer", async () => {
    const r = rooms();
    cleanups.push(
      () => r.guest.close(),
      () => r.attacker.close()
    );
    impostor(r.attacker, (offer) =>
      answerTo(offer, HOST.secretKey, r.attacker.topic, { sdp: "v=0 genuine" })
    );
    const { pcs, createPeerConnection } = factory();
    const link = await dialHost(r.guest, {
      iceServers: [],
      createPeerConnection,
      hostKey: HOST.hostKey,
      gatherTimeoutMs: 10,
      timeoutMs: 2_000,
    });
    expect(pcs[0]?.remote).toEqual([{ type: "answer", sdp: "v=0 genuine" }]);
    link.close();
  });

  it("host answers carry a signature that verifies against its host key", async () => {
    const r = rooms();
    cleanups.push(
      () => r.host.close(),
      () => r.guest.close()
    );
    const answers: SignalEnvelope[] = [];
    r.guest.onEnvelope((env) => {
      if (env.kind === "answer") answers.push(env);
    });
    const host = factory();
    cleanups.push(
      listenForGuests(
        r.host,
        {
          iceServers: [],
          createPeerConnection: host.createPeerConnection,
          signingKey: HOST.secretKey,
        },
        () => {}
      )
    );
    r.guest.send({
      v: 1,
      kind: "offer",
      from: "g1",
      nonce: randomId(12),
      ts: Date.now(),
      sdp: "o",
    });
    await until(() => answers.length === 1);
    expect(answers[0]?.sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it("refuses a dial without a valid host key", async () => {
    const r = rooms();
    cleanups.push(() => r.guest.close());
    await expect(dialHost(r.guest, { iceServers: [], hostKey: "not-a-key" })).rejects.toThrow(
      "invalid host key"
    );
  });
});

describe("join links (F1)", () => {
  it("always include the host key", () => {
    const creds = { ...createSessionCredentials(), relaySecret: "relay-secret-0123456789abcdef" };
    const { hostKeyLink } = deriveHostKeyPair(creds.relaySecret, creds.sessionId);
    expect(joinPath(creds)).toBe(`/join/${creds.sessionId}/${creds.secret}/${hostKeyLink}`);
    expect(joinPath({ ...creds, relaySecret: undefined, hostKey: hostKeyLink })).toBe(
      `/join/${creds.sessionId}/${creds.secret}/${hostKeyLink}`
    );
    expect(() => joinPath(createSessionCredentials())).toThrow(/host key/);
  });

  it("refuses a legacy link without a host key instead of trusting whoever answers", () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    const config = { relays: [], iceServers: [], sameBrowser: false };
    expect(() =>
      joinSession({
        credentials: createSessionCredentials(),
        deviceSecret: "device-secret-0123456789abcdef",
        displayName: "Alice",
        config,
      })
    ).toThrow(LiveShareLegacyLinkError);
    expect(() =>
      joinSession({
        credentials: { ...createSessionCredentials(), hostKey: "x".repeat(43) },
        deviceSecret: "device-secret-0123456789abcdef",
        displayName: "Alice",
        config,
      })
    ).toThrow(/host key is not valid/);
  });
});
