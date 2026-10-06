import { schnorr } from "@noble/curves/secp256k1";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionCredentials,
  deriveSessionKeys,
  fromBase64Url,
  seal,
  toBase64Url,
  unseal,
} from "../src/crypto.js";
import { FRAME_BYTES, createLink, createPipePair } from "../src/link.js";
import { LIVE_SIGNAL_KIND, NostrSignaling, signEvent } from "../src/nostr.js";
import { parseGuestMessage, parseHostMessage } from "../src/protocol.js";
import { joinPath } from "../src/session.js";
import { SignalingRoom, createMemorySignalingHub } from "../src/signaling.js";
import { until } from "./fixtures.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("session crypto", () => {
  it("round-trips sealed payloads and rejects other keys, topics and tampering", () => {
    const keys = deriveSessionKeys(createSessionCredentials());
    const other = deriveSessionKeys(createSessionCredentials());
    const sealed = seal(keys.signalKey, keys.topic, "hello");
    expect(unseal(keys.signalKey, keys.topic, sealed)).toBe("hello");
    expect(unseal(other.signalKey, keys.topic, sealed)).toBeNull();
    expect(unseal(keys.signalKey, other.topic, sealed)).toBeNull();
    const bytes = fromBase64Url(sealed);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(unseal(keys.signalKey, keys.topic, toBase64Url(bytes))).toBeNull();
  });

  it("derives a topic that reveals neither the session id nor the secret", () => {
    const creds = createSessionCredentials();
    const { topic } = deriveSessionKeys(creds);
    expect(topic).toMatch(/^[0-9a-f]{64}$/);
    expect(topic).not.toContain(creds.sessionId);
    expect(joinPath(creds)).toBe(`/join/${creds.sessionId}/${creds.secret}`);
  });
});

describe("link framing", () => {
  it("delivers small and chunked messages intact", async () => {
    const [a, b] = createPipePair();
    const left = createLink(a);
    const right = createLink(b);
    const got: unknown[] = [];
    right.onMessage((m) => got.push(m));
    const big = { blob: "x".repeat(FRAME_BYTES * 5 + 123) };
    left.send({ hi: 1 });
    left.send(big);
    await until(() => got.length === 2);
    expect(got[0]).toEqual({ hi: 1 });
    expect(got[1]).toEqual(big);
    left.close();
    right.close();
  });

  it("closes a link carrying more than the receiver accepts", async () => {
    const [a, b] = createPipePair();
    const left = createLink(a);
    const right = createLink(b, { maxMessageBytes: FRAME_BYTES * 2 });
    left.send({ blob: "x".repeat(FRAME_BYTES * 4) });
    await until(() => right.closed);
    left.close();
  });

  it("propagates close to the other side", async () => {
    const [a, b] = createPipePair();
    const left = createLink(a);
    const right = createLink(b);
    const reasons: string[] = [];
    right.onClose((r) => reasons.push(r));
    left.close();
    await until(() => right.closed);
    expect(reasons).toEqual(["closed by peer"]);
  });

  it("times out a link that stops answering pings", () => {
    vi.useFakeTimers();
    const silent = { send() {}, close() {}, onmessage: null, onclose: null };
    const link = createLink(silent, { heartbeatMs: 1000, timeoutMs: 3000 });
    const reasons: string[] = [];
    link.onClose((r) => reasons.push(r));
    vi.advanceTimersByTime(4500);
    expect(reasons).toEqual(["timed out"]);
  });
});

describe("protocol", () => {
  it("accepts well-formed messages and rejects unknown ones", () => {
    expect(parseGuestMessage({ t: "hello", proto: 2, key: "k".repeat(64), name: "Bob" }).t).toBe(
      "hello"
    );
    expect(parseHostMessage(JSON.stringify({ t: "ack", id: "1", ok: true })).t).toBe("ack");
    expect(() => parseGuestMessage({ t: "welcome" })).toThrow();
    expect(() =>
      parseGuestMessage({
        t: "submit",
        id: "1",
        entries: [{ kind: "outcome", outcome: {} }],
      })
    ).toThrow();
  });
});

describe("signaling room", () => {
  const env = (nonce: string, ts = Date.now()) => ({
    v: 1 as const,
    kind: "offer" as const,
    from: "g1",
    nonce,
    ts,
    sdp: "v=0",
  });

  it("delivers envelopes only to holders of the same credentials, once", async () => {
    const hub = createMemorySignalingHub();
    const creds = createSessionCredentials();
    const host = new SignalingRoom([hub(), hub()], deriveSessionKeys(creds));
    const guest = new SignalingRoom([hub(), hub()], deriveSessionKeys(creds));
    const stranger = new SignalingRoom([hub()], deriveSessionKeys(createSessionCredentials()));
    const got: string[] = [];
    const strangerGot: string[] = [];
    host.onEnvelope((e) => got.push(e.nonce));
    stranger.onEnvelope((e) => strangerGot.push(e.nonce));

    guest.send(env("n1"));
    guest.send(env("n2", Date.now() - 5 * 60_000));
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual(["n1"]);
    expect(strangerGot).toEqual([]);
    for (const r of [host, guest, stranger]) r.close();
  });
});

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
}

describe("nostr signaling", () => {
  it("signs valid NIP-01 events", () => {
    const sk = schnorr.utils.randomPrivateKey();
    const ev = signEvent(sk, {
      kind: LIVE_SIGNAL_KIND,
      created_at: 1,
      tags: [["t", "x"]],
      content: "c",
    });
    expect(schnorr.verify(ev.sig, ev.id, ev.pubkey)).toBe(true);
  });

  it("subscribes, queues until open, publishes and delivers matching events", () => {
    FakeSocket.instances = [];
    const nostr = new NostrSignaling(
      ["wss://a", "wss://b"],
      (url) => new FakeSocket(url) as unknown as WebSocket
    );
    const got: string[] = [];
    nostr.subscribe("topic1", (p) => got.push(p));
    nostr.publish("topic1", "payload-1");
    const [a, b] = FakeSocket.instances;
    if (!a || !b) throw new Error("sockets not created");
    expect(a.sent).toEqual([]);

    a.open();
    const req = a.sent[0] as [string, string, { kinds: number[]; "#t": string[] }];
    expect(req[0]).toBe("REQ");
    expect(req[2]).toMatchObject({ kinds: [LIVE_SIGNAL_KIND], "#t": ["topic1"] });
    expect((a.sent[1] as [string, { content: string }])[1].content).toBe("payload-1");

    const event = (content: string, topic = "topic1") => ({
      data: JSON.stringify([
        "EVENT",
        req[1],
        { kind: LIVE_SIGNAL_KIND, tags: [["t", topic]], content },
      ]),
    });
    a.onmessage?.(event("from-relay"));
    a.onmessage?.(event("other-topic", "topic2"));
    a.onmessage?.({ data: "not json" });
    expect(got).toEqual(["from-relay"]);
    nostr.close();
  });

  it("reconnects to a relay that drops", () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const nostr = new NostrSignaling(
      ["wss://a"],
      (url) => new FakeSocket(url) as unknown as WebSocket
    );
    FakeSocket.instances[0]?.open();
    FakeSocket.instances[0]?.close();
    vi.advanceTimersByTime(1500);
    expect(FakeSocket.instances).toHaveLength(2);
    nostr.close();
  });
});
