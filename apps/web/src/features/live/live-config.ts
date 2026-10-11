import {
  DEFAULT_NETWORK_CONFIG,
  type LiveNetworkConfig,
  type SessionCredentials,
  createSessionCredentials,
  deriveHostKeyPair,
  joinPath,
  randomId,
} from "@decisionator/share-inpage";

const NETWORK_KEY = "deci.live.network";
const HOST_KEY_PREFIX = "deci.live.host.";
const BY_SESSION_KEY_PREFIX = "deci.live.bySession.";
const REVOKED_KEY_PREFIX = "deci.live.revoked.";
const DEVICE_KEY = "deci.live.device";
const NAME_KEY = "deci.live.name";
const PUBLIC_BASE_KEY = "deci.live.publicBase";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode): fall back to per-load values.
  }
}

/** Build-time defaults: `VITE_LIVE_RELAYS` (comma-separated, may be empty) and `VITE_LIVE_ICE_SERVERS` (JSON). */
function buildDefaults(): LiveNetworkConfig {
  const env = import.meta.env;
  const relays =
    typeof env.VITE_LIVE_RELAYS === "string"
      ? env.VITE_LIVE_RELAYS.split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : DEFAULT_NETWORK_CONFIG.relays;
  let iceServers = DEFAULT_NETWORK_CONFIG.iceServers;
  if (typeof env.VITE_LIVE_ICE_SERVERS === "string" && env.VITE_LIVE_ICE_SERVERS) {
    try {
      iceServers = JSON.parse(env.VITE_LIVE_ICE_SERVERS) as RTCIceServer[];
    } catch {
      // keep the defaults
    }
  }
  return { ...DEFAULT_NETWORK_CONFIG, relays, iceServers };
}

export function defaultNetworkConfig(): LiveNetworkConfig {
  return buildDefaults();
}

/** The network settings in effect: the user's overrides from Settings, else the build defaults. */
function validRateLimit(v: unknown): v is { burst: number; perSecond: number } {
  const r = v as { burst?: unknown; perSecond?: unknown } | undefined;
  return (
    typeof r?.burst === "number" &&
    r.burst >= 1 &&
    typeof r.perSecond === "number" &&
    r.perSecond > 0
  );
}

export function loadNetworkConfig(): LiveNetworkConfig {
  const defaults = buildDefaults();
  const raw = read(NETWORK_KEY);
  if (!raw) return defaults;
  try {
    const saved = JSON.parse(raw) as Partial<LiveNetworkConfig>;
    return {
      relays: Array.isArray(saved.relays) ? saved.relays : defaults.relays,
      iceServers: Array.isArray(saved.iceServers) ? saved.iceServers : defaults.iceServers,
      sameBrowser: typeof saved.sameBrowser === "boolean" ? saved.sameBrowser : true,
      ...(validRateLimit(saved.rateLimit) ? { rateLimit: saved.rateLimit } : {}),
    };
  } catch {
    return defaults;
  }
}

export function saveNetworkConfig(config: LiveNetworkConfig | null): void {
  write(NETWORK_KEY, config ? JSON.stringify(config) : null);
}

export interface HostSessionRecord extends SessionCredentials {
  sessionId: string;
  secret: string;
  /** 256-bit base64url; NEVER leaves this browser. Seeds the relay signing key. */
  relaySecret: string;
  createdAt: string;
  hostKey?: string;
}

export function saveHostSessionIndex(sessionId: string, projectKey: string): void {
  write(`${BY_SESSION_KEY_PREFIX}${sessionId}`, projectKey);
}

export function resolveHostProject(sessionId: string): string | null {
  return read(`${BY_SESSION_KEY_PREFIX}${sessionId}`);
}

export function removeHostSessionIndex(sessionId: string): void {
  write(`${BY_SESSION_KEY_PREFIX}${sessionId}`, null);
}

export interface SessionRevocationRecord {
  revokedAt: string;
  reason?: string;
}

export function isSessionRevoked(sessionId: string): boolean {
  return read(`${REVOKED_KEY_PREFIX}${sessionId}`) !== null;
}

export function getSessionRevocation(sessionId: string): SessionRevocationRecord | null {
  const raw = read(`${REVOKED_KEY_PREFIX}${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRevocationRecord;
  } catch {
    return { revokedAt: new Date().toISOString() };
  }
}

export function markSessionRevoked(sessionId: string, reason?: string): void {
  const record: SessionRevocationRecord = {
    revokedAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
  write(`${REVOKED_KEY_PREFIX}${sessionId}`, JSON.stringify(record));
  removeHostSessionIndex(sessionId);
}

export function clearSessionRevocation(sessionId: string): void {
  write(`${REVOKED_KEY_PREFIX}${sessionId}`, null);
}

export function listHostedProjectKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(HOST_KEY_PREFIX)) {
        keys.push(k.slice(HOST_KEY_PREFIX.length));
      }
    }
  } catch {
    // ignore
  }
  return keys;
}

/**
 * A project keeps the same join link on this device, so a QR code handed out earlier keeps
 * working after the host reloads, and returning guests keep their identity (and their votes).
 */
export function hostCredentialsFor(projectKey: string): HostSessionRecord {
  const key = HOST_KEY_PREFIX + projectKey;
  const raw = read(key);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Partial<HostSessionRecord>;
      if (saved.sessionId && saved.secret) {
        let changed = false;
        let relaySecret = saved.relaySecret;
        if (!relaySecret) {
          relaySecret = randomId(32);
          changed = true;
        }
        const createdAt = saved.createdAt ?? new Date().toISOString();
        if (!saved.createdAt) changed = true;

        const { hostKeyLink } = deriveHostKeyPair(relaySecret, saved.sessionId);
        const record: HostSessionRecord = {
          sessionId: saved.sessionId,
          secret: saved.secret,
          relaySecret,
          createdAt,
          hostKey: hostKeyLink,
        };
        if (changed || saved.hostKey !== hostKeyLink) {
          write(key, JSON.stringify(record));
        }
        saveHostSessionIndex(record.sessionId, projectKey);
        return record;
      }
    } catch {
      // regenerate below
    }
  }
  const creds = createSessionCredentials();
  const relaySecret = randomId(32);
  const createdAt = new Date().toISOString();
  const { hostKeyLink } = deriveHostKeyPair(relaySecret, creds.sessionId);
  const record: HostSessionRecord = {
    sessionId: creds.sessionId,
    secret: creds.secret,
    relaySecret,
    createdAt,
    hostKey: hostKeyLink,
  };
  write(key, JSON.stringify(record));
  saveHostSessionIndex(record.sessionId, projectKey);
  return record;
}

export function rotateHostCredentials(projectKey: string): HostSessionRecord {
  const key = HOST_KEY_PREFIX + projectKey;
  const creds = createSessionCredentials();
  const relaySecret = randomId(32);
  const createdAt = new Date().toISOString();
  const { hostKeyLink } = deriveHostKeyPair(relaySecret, creds.sessionId);
  const record: HostSessionRecord = {
    sessionId: creds.sessionId,
    secret: creds.secret,
    relaySecret,
    createdAt,
    hostKey: hostKeyLink,
  };
  write(key, JSON.stringify(record));
  saveHostSessionIndex(record.sessionId, projectKey);
  return record;
}

/** Device-wide secret guest identities are derived from (never sent as is). */
export function guestDeviceSecret(): string {
  let secret = read(DEVICE_KEY);
  if (!secret) {
    secret = randomId(32);
    write(DEVICE_KEY, secret);
  }
  return secret;
}

export function savedGuestName(): string {
  return read(NAME_KEY) ?? "";
}

export function saveGuestName(name: string): void {
  write(NAME_KEY, name);
}

const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\]|::1)$|\.localhost$/i;

export function isLoopbackHost(hostname = window.location.hostname): boolean {
  return LOOPBACK.test(hostname);
}

/** The app address guests are sent to: this page's, unless the host overrode a localhost one. */
export function appBaseUrl(): string {
  const own = `${window.location.origin}${window.location.pathname}`;
  if (!isLoopbackHost()) return own;
  return read(PUBLIC_BASE_KEY) || own;
}

export function savePublicBaseUrl(url: string | null): void {
  write(PUBLIC_BASE_KEY, url);
}

export function joinUrl(credentials: SessionCredentials, base = appBaseUrl()): string {
  return `${base}#${joinPath(credentials)}`;
}
