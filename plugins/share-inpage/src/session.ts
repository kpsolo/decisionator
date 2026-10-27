import {
  type SessionCredentials,
  deriveHostKeyPair,
  deriveSessionKeys,
  isValidHostKey,
  parseHostKeyFromLink,
  seal,
  unseal,
} from "./crypto.js";
import { LiveShareGuest } from "./guest.js";
import { LiveShareHost } from "./host.js";
import type { HostedProject } from "./hosted-project.js";
import {
  NIP09_DELETION_KIND,
  NIP78_SNAPSHOT_KIND,
  NostrSignaling,
  type RelayPayload,
  type SocketFactory,
  lastPublishedRecord,
  signEvent,
} from "./nostr.js";
import { type LiveRole, parseRelayPayload } from "./protocol.js";
import { dialHost, isWebRtcAvailable, listenForGuests } from "./rtc.js";
import { BroadcastChannelSignaling, SignalingRoom, type SignalingTransport } from "./signaling.js";

/** How peers find each other and connect. Every part can be replaced by the user. */
export interface LiveNetworkConfig {
  /** Nostr relays used to exchange connection offers. Empty: same-browser only. */
  relays: string[];
  /** STUN/TURN servers for NAT traversal. Add a TURN server for strict corporate networks. */
  iceServers: RTCIceServer[];
  /** Also rendezvous through BroadcastChannel (other tabs of this browser). */
  sameBrowser: boolean;
  /** Per-guest submission limit applied by the host (default 20 at once, 5 per second). */
  rateLimit?: { burst: number; perSecond: number };
  /** Stop retrying after this long without a connection (default 8s when relays empty, else 30s). */
  giveUpAfterMs?: number;
  /** Timeout for dialing host on WebRTC data channel (default 5s when relays empty, else 15s). */
  dialTimeoutMs?: number;
}

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
];

export const DEFAULT_NETWORK_CONFIG: LiveNetworkConfig = {
  relays: DEFAULT_RELAYS,
  iceServers: DEFAULT_ICE_SERVERS,
  sameBrowser: true,
};

export class LiveShareUnsupportedError extends Error {
  constructor() {
    super("This browser does not support live sessions (WebRTC is unavailable or disabled).");
    this.name = "LiveShareUnsupportedError";
  }
}

function openRoom(credentials: SessionCredentials, config: LiveNetworkConfig): SignalingRoom {
  const transports: SignalingTransport[] = [];
  if (config.sameBrowser && BroadcastChannelSignaling.isAvailable()) {
    transports.push(new BroadcastChannelSignaling());
  }
  if (config.relays.length > 0) transports.push(new NostrSignaling(config.relays));
  return new SignalingRoom(transports, deriveSessionKeys(credentials));
}

export interface RevokeOptions {
  /**
   * Replace the relay snapshot with a tombstone (and ask relays to delete the last snapshot).
   * Default true (contract session-restore §6.1).
   */
  purgeRelays?: boolean;
  /** Longest wait for relays to confirm the tombstone. Default {@link TOMBSTONE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface HostingSession {
  readonly credentials: SessionCredentials;
  readonly host: LiveShareHost;
  close(reason?: string): void;
  /**
   * Disconnects every guest with `session_revoked`, then (unless `purgeRelays` is false)
   * publishes the relay tombstone and waits for relays to confirm it, or for the timeout,
   * before closing the relay connections.
   */
  revoke(reason?: string, opts?: RevokeOptions): Promise<void>;
}

/** Default wait for relays to confirm a tombstone. */
export const TOMBSTONE_TIMEOUT_MS = 5_000;

/**
 * Publishes the revocation tombstone over `nostr`, signed by the session's host key, plus a
 * best-effort NIP-09 deletion of the last snapshot this tab published. Resolves `true` once at
 * least one relay stored the tombstone; `false` when none did within `timeoutMs`.
 */
async function sendTombstone(
  nostr: NostrSignaling,
  credentials: SessionCredentials,
  timeoutMs: number,
  reason: "revoked" | "ended" = "revoked"
): Promise<boolean> {
  if (!credentials.relaySecret) return false;
  const keys = deriveSessionKeys(credentials);
  const hostKeyPair = deriveHostKeyPair(credentials.relaySecret, credentials.sessionId);
  const previous = lastPublishedRecord(hostKeyPair.hostKey, keys.topic);
  if (previous) {
    nostr.publishEvent(
      signEvent(hostKeyPair.secretKey, {
        kind: NIP09_DELETION_KIND,
        created_at: Math.max(Math.floor(Date.now() / 1000), previous.created_at),
        tags: [
          ["e", previous.id],
          ["k", String(NIP78_SNAPSHOT_KIND)],
        ],
        content: reason === "ended" ? "Session ended" : "Session link revoked",
      })
    );
  }
  const payload: RelayPayload = { v: 1, type: "tombstone", publishedAt: Date.now(), reason };
  const sealed = seal(keys.signalKey, keys.topic, JSON.stringify(payload));
  // publishSnapshot dates it strictly after the previous record for this key and topic.
  const tombstone = nostr.publishSnapshot(keys.topic, hostKeyPair.secretKey, sealed);
  return nostr.publishConfirmed(tombstone, timeoutMs);
}

/**
 * Publishes the relay tombstone for a session that is not hosted right now (for example a
 * revoke from the Sessions dashboard): opens its own relay connections, waits for a relay to
 * confirm (or the timeout), then closes them. Needs the host-only `relaySecret`.
 */
export async function publishTombstone(opts: {
  credentials: SessionCredentials;
  relays: string[];
  timeoutMs?: number;
  /** Injected in tests; defaults to the browser's WebSocket. */
  createSocket?: SocketFactory;
}): Promise<boolean> {
  if (!opts.credentials.relaySecret || opts.relays.length === 0) return false;
  const nostr = new NostrSignaling(opts.relays, opts.createSocket);
  try {
    return await sendTombstone(nostr, opts.credentials, opts.timeoutMs ?? TOMBSTONE_TIMEOUT_MS);
  } finally {
    nostr.close();
  }
}

/** Default wait for relays to confirm the "ended" tombstone published by `close()`. */
export const END_TOMBSTONE_TIMEOUT_MS = 2_000;

/**
 * Thrown by {@link joinSession} for a join link without a host key (made before contract
 * live-share v3.2.0). Such a link cannot authenticate the host, so it is refused rather than
 * trusting whoever answers; the owner has to share the link again.
 */
export class LiveShareLegacyLinkError extends Error {
  constructor() {
    super(
      "This join link is from an older version of Deci and cannot prove it leads to the host. Ask the owner to share the session link again."
    );
    this.name = "LiveShareLegacyLinkError";
  }
}

/**
 * Starts serving `project`; resolves once the project is loaded and offers are being answered.
 * The credentials must carry the host-only `relaySecret`: the host key derived from it signs
 * every signaling answer, and guests refuse unsigned ones.
 */
export async function startHosting(opts: {
  project: HostedProject;
  credentials: SessionCredentials;
  config: LiveNetworkConfig;
  role?: LiveRole;
  /** Wait for relays to confirm the "ended" tombstone on `close()` before closing them. */
  endTombstoneTimeoutMs?: number;
}): Promise<HostingSession> {
  if (!isWebRtcAvailable()) throw new LiveShareUnsupportedError();
  if (!opts.credentials.relaySecret) {
    throw new Error("Hosting needs the session's relay secret (host key).");
  }
  const room = openRoom(opts.credentials, opts.config);
  const sessionKeys = deriveSessionKeys(opts.credentials);
  const hostKeyPair = deriveHostKeyPair(opts.credentials.relaySecret, opts.credentials.sessionId);

  const host = new LiveShareHost({
    project: opts.project,
    role: opts.role,
    relaySecret: opts.credentials.relaySecret,
    sessionId: opts.credentials.sessionId,
    ...(opts.config.rateLimit ? { rateLimit: opts.config.rateLimit } : {}),
    onPublishRelay(_type, payload) {
      const sealed = seal(sessionKeys.signalKey, sessionKeys.topic, JSON.stringify(payload));
      for (const t of room.getTransports()) {
        if (t instanceof NostrSignaling) {
          t.publishSnapshot(sessionKeys.topic, hostKeyPair.secretKey, sealed);
        }
      }
    },
  });
  await host.start();
  const stopListening = listenForGuests(
    room,
    { iceServers: opts.config.iceServers, signingKey: hostKeyPair.secretKey },
    (link) => host.accept(link)
  );
  let closed = false;
  return {
    credentials: opts.credentials,
    host,
    close(reason) {
      if (closed) return;
      closed = true;
      host.close(reason);
      stopListening();
      // Retract the last snapshot from public relays: an "ended" tombstone replaces it, plus a
      // best-effort NIP-09 deletion. Fire and forget so closing (e.g. on pagehide) never waits;
      // the relay sockets close once a relay confirmed it or the short timeout passed.
      const nostr = room.getTransports().find((t) => t instanceof NostrSignaling);
      if (nostr instanceof NostrSignaling) {
        void sendTombstone(
          nostr,
          opts.credentials,
          opts.endTombstoneTimeoutMs ?? END_TOMBSTONE_TIMEOUT_MS,
          "ended"
        )
          .catch(() => false)
          .finally(() => room.close());
      } else {
        room.close();
      }
    },
    async revoke(reason, revokeOpts = {}) {
      if (closed) return;
      closed = true;
      // The tombstone goes out below, where we can wait for the relays to store it.
      host.revoke(reason, { tombstone: false });
      stopListening();
      try {
        if (revokeOpts.purgeRelays !== false) {
          const nostr = room.getTransports().find((t) => t instanceof NostrSignaling);
          if (nostr instanceof NostrSignaling) {
            await sendTombstone(
              nostr,
              opts.credentials,
              revokeOpts.timeoutMs ?? TOMBSTONE_TIMEOUT_MS
            );
          }
        }
      } finally {
        room.close();
      }
    },
  };
}

/** Creates a guest for a join link. Call `start()` on it to connect. */
export function joinSession(opts: {
  credentials: SessionCredentials;
  deviceSecret: string;
  displayName: string;
  config: LiveNetworkConfig;
  onNotice?: (message: string) => void;
}): { guest: LiveShareGuest; dispose(): void } {
  if (!isWebRtcAvailable()) throw new LiveShareUnsupportedError();
  // The host key from the link is the only trust anchor: without it any link holder could answer
  // as the host and collect this guest's participant key (contract live-share v3.2.0).
  if (!opts.credentials.hostKey) throw new LiveShareLegacyLinkError();
  const normHostKey = parseHostKeyFromLink(opts.credentials.hostKey);
  if (!isValidHostKey(normHostKey)) {
    throw new Error(
      "This join link is damaged (its host key is not valid). Ask the owner for it again."
    );
  }
  const room = openRoom(opts.credentials, opts.config);

  const guest = new LiveShareGuest({
    sessionId: opts.credentials.sessionId,
    deviceSecret: opts.deviceSecret,
    displayName: opts.displayName,
    hostKey: normHostKey,
    dial: (signal) =>
      dialHost(
        room,
        {
          iceServers: opts.config.iceServers,
          hostKey: normHostKey,
          timeoutMs:
            opts.config.dialTimeoutMs ?? (opts.config.relays.length === 0 ? 5_000 : 15_000),
        },
        signal
      ),
    onNotice: opts.onNotice,
    giveUpAfterMs: opts.config.giveUpAfterMs ?? (opts.config.relays.length === 0 ? 6_000 : 30_000),
  });

  const sessionKeys = deriveSessionKeys(opts.credentials);
  const unsubs: (() => void)[] = [];
  for (const t of room.getTransports()) {
    if (t instanceof NostrSignaling) {
      unsubs.push(
        t.subscribeSnapshot(sessionKeys.topic, normHostKey, (event) => {
          const unsealed = unseal(sessionKeys.signalKey, sessionKeys.topic, event.content);
          if (!unsealed) return;
          const payload = parseRelayPayload(unsealed);
          if (payload) guest.applyRelayPayload(payload, normHostKey);
        })
      );
    }
  }

  return {
    guest,
    dispose() {
      for (const u of unsubs) u();
      guest.leave();
      room.close();
    },
  };
}

/**
 * Route path of a join link (hash routing keeps it in the URL fragment, off every server). Every
 * link carries the host key: taken from `hostKey`, or derived from the host-only `relaySecret`.
 * Throws when neither is present, since guests refuse links without it.
 */
export function joinPath(credentials: SessionCredentials): string {
  const hostKey =
    credentials.hostKey ??
    (credentials.relaySecret
      ? deriveHostKeyPair(credentials.relaySecret, credentials.sessionId).hostKeyLink
      : undefined);
  if (!hostKey) throw new Error("A join link needs the session's host key.");
  return `/join/${credentials.sessionId}/${credentials.secret}/${hostKey}`;
}
