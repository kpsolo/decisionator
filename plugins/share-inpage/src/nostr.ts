import type { Unsubscribe } from "@decisionator/plugin-sdk";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { randomId } from "./crypto.js";
import type { SignalingTransport } from "./signaling.js";

/**
 * Network rendezvous over public Nostr relays (NIP-01). Messages are ephemeral events (the
 * 20000–29999 kind range relays forward but do not store), signed with a throwaway key, tagged
 * with the session topic and carrying only sealed payloads. Relays never see who is in a session
 * or what they exchange; they only pass connection offers between the host and its guests.
 */
export const LIVE_SIGNAL_KIND = 25_050;

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export function signEvent(
  secretKey: Uint8Array,
  template: Pick<NostrEvent, "kind" | "tags" | "content" | "created_at">
): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
  const serialized = JSON.stringify([
    0,
    pubkey,
    template.created_at,
    template.kind,
    template.tags,
    template.content,
  ]);
  const id = bytesToHex(sha256(utf8ToBytes(serialized)));
  const sig = bytesToHex(schnorr.sign(id, secretKey));
  return { ...template, id, pubkey, sig };
}

type SocketFactory = (url: string) => WebSocket;

interface RelayConnection {
  url: string;
  socket: WebSocket | null;
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
  outbox: string[];
}

export class NostrSignaling implements SignalingTransport {
  readonly name = "nostr";
  private readonly secretKey = schnorr.utils.randomPrivateKey();
  private relays: RelayConnection[];
  private topics = new Map<string, { subId: string; handlers: Set<(p: string) => void> }>();
  private closed = false;

  constructor(
    relayUrls: string[],
    private readonly createSocket: SocketFactory = (url) => new WebSocket(url)
  ) {
    this.relays = relayUrls.map((url) => ({
      url,
      socket: null,
      retry: 0,
      timer: null,
      outbox: [],
    }));
    for (const r of this.relays) this.open(r);
  }

  publish(topic: string, payload: string): void {
    const event = signEvent(this.secretKey, {
      kind: LIVE_SIGNAL_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", topic]],
      content: payload,
    });
    const frame = JSON.stringify(["EVENT", event]);
    for (const r of this.relays) this.sendOrQueue(r, frame);
  }

  subscribe(topic: string, onPayload: (payload: string) => void): Unsubscribe {
    let entry = this.topics.get(topic);
    if (!entry) {
      entry = { subId: randomId(8), handlers: new Set() };
      this.topics.set(topic, entry);
      for (const r of this.relays) {
        if (r.socket?.readyState === 1) r.socket.send(this.reqFrame(topic, entry.subId));
      }
    }
    entry.handlers.add(onPayload);
    return () => {
      const e = this.topics.get(topic);
      if (!e) return;
      e.handlers.delete(onPayload);
      if (e.handlers.size === 0) {
        this.topics.delete(topic);
        for (const r of this.relays) {
          if (r.socket?.readyState === 1) r.socket.send(JSON.stringify(["CLOSE", e.subId]));
        }
      }
    };
  }

  close(): void {
    this.closed = true;
    for (const r of this.relays) {
      if (r.timer) clearTimeout(r.timer);
      r.socket?.close();
      r.socket = null;
    }
    this.topics.clear();
  }

  private reqFrame(topic: string, subId: string): string {
    // `since` slightly in the past so a message sent while we were subscribing is not missed.
    const since = Math.floor(Date.now() / 1000) - 30;
    return JSON.stringify(["REQ", subId, { kinds: [LIVE_SIGNAL_KIND], "#t": [topic], since }]);
  }

  private sendOrQueue(r: RelayConnection, frame: string): void {
    if (r.socket?.readyState === 1) {
      r.socket.send(frame);
    } else {
      r.outbox.push(frame);
      if (r.outbox.length > 50) r.outbox.shift();
    }
  }

  private open(r: RelayConnection): void {
    if (this.closed) return;
    let socket: WebSocket;
    try {
      socket = this.createSocket(r.url);
    } catch {
      this.reopenLater(r);
      return;
    }
    r.socket = socket;
    socket.onopen = () => {
      r.retry = 0;
      for (const [topic, e] of this.topics) socket.send(this.reqFrame(topic, e.subId));
      const queued = r.outbox.splice(0);
      for (const frame of queued) socket.send(frame);
    };
    socket.onmessage = (msg) => this.onRelayMessage(msg.data);
    socket.onclose = () => {
      if (r.socket === socket) {
        r.socket = null;
        this.reopenLater(r);
      }
    };
    socket.onerror = () => socket.close();
  }

  private reopenLater(r: RelayConnection): void {
    if (this.closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** r.retry);
    r.retry++;
    r.timer = setTimeout(() => this.open(r), delay);
  }

  private onRelayMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg[0] !== "EVENT") return;
    const event = msg[2] as Partial<NostrEvent> | undefined;
    if (!event || event.kind !== LIVE_SIGNAL_KIND || typeof event.content !== "string") return;
    // Authenticity comes from the sealed payload, so the event signature need not be checked.
    const topic = event.tags?.find((t) => t[0] === "t")?.[1];
    if (!topic) return;
    const entry = this.topics.get(topic);
    if (!entry || entry.subId !== msg[1]) return;
    for (const cb of entry.handlers) cb(event.content);
  }
}
