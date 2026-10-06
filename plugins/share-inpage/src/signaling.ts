import type { Unsubscribe } from "@decisionator/plugin-sdk";
import { type SessionKeys, seal, unseal } from "./crypto.js";
import { type SignalEnvelope, SignalEnvelopeSchema } from "./protocol.js";

/**
 * A rendezvous medium: carries opaque strings under a topic. It never sees plaintext; everything
 * published is sealed with the session key by {@link SignalingRoom}.
 */
export interface SignalingTransport {
  readonly name: string;
  publish(topic: string, payload: string): void;
  subscribe(topic: string, onPayload: (payload: string) => void): Unsubscribe;
  close(): void;
}

/** Envelopes older than this are ignored (replays, relay backlog). */
const MAX_AGE_MS = 60_000;

/**
 * An encrypted signaling room over one or more transports. Messages go out on every transport
 * and are de-duplicated on the way in, so one unreachable relay does not break the session.
 */
export class SignalingRoom {
  private seen = new Set<string>();
  private unsubs: Unsubscribe[] = [];
  private handlers = new Set<(env: SignalEnvelope) => void>();

  constructor(
    private readonly transports: SignalingTransport[],
    private readonly keys: SessionKeys
  ) {
    for (const t of transports) {
      this.unsubs.push(t.subscribe(keys.topic, (payload) => this.receive(payload)));
    }
  }

  send(env: SignalEnvelope): void {
    this.seen.add(env.nonce);
    const payload = seal(this.keys.signalKey, this.keys.topic, JSON.stringify(env));
    for (const t of this.transports) {
      try {
        t.publish(this.keys.topic, payload);
      } catch {
        // One failing relay must not stop the others.
      }
    }
  }

  onEnvelope(cb: (env: SignalEnvelope) => void): Unsubscribe {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }

  close(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.handlers.clear();
    for (const t of this.transports) t.close();
  }

  private receive(payload: string): void {
    const json = unseal(this.keys.signalKey, this.keys.topic, payload);
    if (!json) return;
    let env: SignalEnvelope;
    try {
      env = SignalEnvelopeSchema.parse(JSON.parse(json));
    } catch {
      return;
    }
    if (this.seen.has(env.nonce) || Math.abs(Date.now() - env.ts) > MAX_AGE_MS) return;
    this.seen.add(env.nonce);
    if (this.seen.size > 2000) this.seen.clear();
    for (const cb of this.handlers) cb(env);
  }
}

/** Same-browser rendezvous: tabs of one browser profile, no network. */
export class BroadcastChannelSignaling implements SignalingTransport {
  readonly name = "broadcast-channel";
  private channels = new Set<BroadcastChannel>();

  static isAvailable(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  publish(topic: string, payload: string): void {
    const ch = new BroadcastChannel(`deci-live:${topic}`);
    ch.postMessage(payload);
    ch.close();
  }

  subscribe(topic: string, onPayload: (payload: string) => void): Unsubscribe {
    const ch = new BroadcastChannel(`deci-live:${topic}`);
    ch.onmessage = (e) => {
      if (typeof e.data === "string") onPayload(e.data);
    };
    this.channels.add(ch);
    return () => {
      ch.close();
      this.channels.delete(ch);
    };
  }

  close(): void {
    for (const ch of this.channels) ch.close();
    this.channels.clear();
  }
}

/** In-process rendezvous for tests. Every instance created from one hub sees the others. */
export function createMemorySignalingHub(): () => SignalingTransport {
  const subs = new Map<string, Set<(p: string) => void>>();
  return () => {
    const mine = new Set<() => void>();
    return {
      name: "memory",
      publish(topic, payload) {
        for (const cb of subs.get(topic) ?? []) queueMicrotask(() => cb(payload));
      },
      subscribe(topic, onPayload) {
        let set = subs.get(topic);
        if (!set) {
          set = new Set();
          subs.set(topic, set);
        }
        set.add(onPayload);
        const off = () => set?.delete(onPayload);
        mine.add(off);
        return off;
      },
      close() {
        for (const off of mine) off();
        mine.clear();
      },
    };
  };
}
