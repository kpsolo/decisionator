import { type SessionCredentials, deriveSessionKeys } from "./crypto.js";
import { LiveShareGuest } from "./guest.js";
import { LiveShareHost } from "./host.js";
import type { HostedProject } from "./hosted-project.js";
import { NostrSignaling } from "./nostr.js";
import type { LiveRole } from "./protocol.js";
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

export interface HostingSession {
  readonly credentials: SessionCredentials;
  readonly host: LiveShareHost;
  close(reason?: string): void;
}

/** Starts serving `project`; resolves once the project is loaded and offers are being answered. */
export async function startHosting(opts: {
  project: HostedProject;
  credentials: SessionCredentials;
  config: LiveNetworkConfig;
  role?: LiveRole;
}): Promise<HostingSession> {
  if (!isWebRtcAvailable()) throw new LiveShareUnsupportedError();
  const host = new LiveShareHost({
    project: opts.project,
    role: opts.role,
    ...(opts.config.rateLimit ? { rateLimit: opts.config.rateLimit } : {}),
  });
  await host.start();
  const room = openRoom(opts.credentials, opts.config);
  const stopListening = listenForGuests(room, { iceServers: opts.config.iceServers }, (link) =>
    host.accept(link)
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
      room.close();
    },
  };
}

/** Creates a guest for a join link. Call `start()` on it to connect. */
export function joinSession(opts: {
  credentials: SessionCredentials;
  deviceSecret: string;
  displayName: string;
  config: LiveNetworkConfig;
}): { guest: LiveShareGuest; dispose(): void } {
  if (!isWebRtcAvailable()) throw new LiveShareUnsupportedError();
  const room = openRoom(opts.credentials, opts.config);
  const guest = new LiveShareGuest({
    sessionId: opts.credentials.sessionId,
    deviceSecret: opts.deviceSecret,
    displayName: opts.displayName,
    dial: (signal) => dialHost(room, { iceServers: opts.config.iceServers }, signal),
  });
  return {
    guest,
    dispose() {
      guest.leave();
      room.close();
    },
  };
}

/** Route path of a join link (hash routing keeps it in the URL fragment, off every server). */
export function joinPath(credentials: SessionCredentials): string {
  return `/join/${credentials.sessionId}/${credentials.secret}`;
}
