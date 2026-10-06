import type { Unsubscribe } from "@decisionator/plugin-sdk";
import { randomId } from "./crypto.js";
import { type Link, type LinkOptions, type MessagePipe, createLink } from "./link.js";
import type { SignalingRoom } from "./signaling.js";

/**
 * WebRTC data channels, star-shaped: every guest connects to the host only. Signaling is
 * non-trickle (one offer, one answer, each carrying its gathered ICE candidates) so a rendezvous
 * needs just two messages.
 */

export interface RtcOptions {
  iceServers: RTCIceServer[];
  /** Longest wait for ICE gathering before sending what has been found. */
  gatherTimeoutMs?: number;
  linkOptions?: LinkOptions;
  /** Injected in tests; defaults to the browser's RTCPeerConnection. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

export function isWebRtcAvailable(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

function makePc(opts: RtcOptions): RTCPeerConnection {
  const config: RTCConfiguration = { iceServers: opts.iceServers };
  return opts.createPeerConnection
    ? opts.createPeerConnection(config)
    : new RTCPeerConnection(config);
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function pipeFromChannel(channel: RTCDataChannel, pc: RTCPeerConnection): MessagePipe {
  const pipe: MessagePipe = {
    send: (data) => channel.send(data),
    close: () => {
      channel.close();
      pc.close();
    },
    onmessage: null,
    onclose: null,
  };
  channel.onmessage = (e) => pipe.onmessage?.(typeof e.data === "string" ? e.data : "");
  const closed = () => pipe.onclose?.();
  channel.onclose = closed;
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") closed();
  });
  return pipe;
}

/** Answers guests' offers and hands each opened channel to `onLink`. */
export function listenForGuests(
  room: SignalingRoom,
  opts: RtcOptions,
  onLink: (link: Link) => void
): Unsubscribe {
  /** Connection attempts in progress, by guest attempt id, with the answer once made. */
  const pending = new Map<string, { pc: RTCPeerConnection; answer?: string }>();
  const connected = new Set<string>();
  const hostId = randomId(8);
  const gatherTimeoutMs = opts.gatherTimeoutMs ?? 3000;

  const sendAnswer = (to: string, sdp: string) =>
    room.send({ v: 1, kind: "answer", from: hostId, to, nonce: randomId(12), ts: Date.now(), sdp });

  const off = room.onEnvelope(async (env) => {
    if (env.kind !== "offer" || connected.has(env.from)) return;
    // A guest re-sends its offer until it hears back; the answer may have been lost on the way.
    const existing = pending.get(env.from);
    if (existing) {
      if (existing.answer) sendAnswer(env.from, existing.answer);
      return;
    }
    const pc = makePc(opts);
    const attempt: { pc: RTCPeerConnection; answer?: string } = { pc };
    pending.set(env.from, attempt);
    const forget = setTimeout(() => {
      if (pending.get(env.from) === attempt) {
        pending.delete(env.from);
        pc.close();
      }
    }, 60_000);

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      const ready = () => {
        clearTimeout(forget);
        pending.delete(env.from);
        connected.add(env.from);
        onLink(createLink(pipeFromChannel(channel, pc), opts.linkOptions));
      };
      if (channel.readyState === "open") ready();
      else channel.onopen = ready;
    };
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: env.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGathering(pc, gatherTimeoutMs);
      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("no local description");
      attempt.answer = sdp;
      sendAnswer(env.from, sdp);
    } catch {
      clearTimeout(forget);
      pending.delete(env.from);
      pc.close();
    }
  });

  return () => {
    off();
    for (const a of pending.values()) a.pc.close();
    pending.clear();
  };
}

/**
 * Connects to the host. The offer is re-sent every few seconds because a host that was offline
 * (or between reloads) when it was first published never saw it.
 */
export async function dialHost(
  room: SignalingRoom,
  opts: RtcOptions & { timeoutMs?: number; resendMs?: number },
  signal?: AbortSignal
): Promise<Link> {
  const id = randomId(8);
  const pc = makePc(opts);
  const channel = pc.createDataChannel("deci-live", { ordered: true });
  let offAnswer: Unsubscribe = () => {};
  let resend: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    offAnswer();
    clearInterval(resend);
    clearTimeout(timeout);
  };

  try {
    return await new Promise<Link>((resolve, reject) => {
      const fail = (reason: string) => {
        cleanup();
        pc.close();
        reject(new Error(reason));
      };
      timeout = setTimeout(() => fail("host not reachable"), opts.timeoutMs ?? 20_000);
      signal?.addEventListener("abort", () => fail("aborted"), { once: true });

      channel.onopen = () => {
        cleanup();
        resolve(createLink(pipeFromChannel(channel, pc), opts.linkOptions));
      };
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") fail("connection failed");
      });

      let answered = false;
      offAnswer = room.onEnvelope(async (env) => {
        if (env.kind !== "answer" || env.to !== id || answered) return;
        answered = true;
        clearInterval(resend);
        try {
          await pc.setRemoteDescription({ type: "answer", sdp: env.sdp });
        } catch {
          fail("bad answer");
        }
      });

      (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        await waitForIceGathering(pc, opts.gatherTimeoutMs ?? 3000);
        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error("no local description");
        const sendOffer = () =>
          room.send({ v: 1, kind: "offer", from: id, nonce: randomId(12), ts: Date.now(), sdp });
        sendOffer();
        resend = setInterval(() => {
          if (!answered) sendOffer();
        }, opts.resendMs ?? 3000);
      })().catch(() => fail("could not create offer"));
    });
  } finally {
    cleanup();
  }
}
