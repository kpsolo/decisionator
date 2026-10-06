import {
  DEFAULT_NETWORK_CONFIG,
  type LiveNetworkConfig,
  type SessionCredentials,
  createSessionCredentials,
  joinPath,
  randomId,
} from "@decisionator/share-inpage";

const NETWORK_KEY = "deci.live.network";
const HOST_KEY_PREFIX = "deci.live.host.";
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
    };
  } catch {
    return defaults;
  }
}

export function saveNetworkConfig(config: LiveNetworkConfig | null): void {
  write(NETWORK_KEY, config ? JSON.stringify(config) : null);
}

/**
 * A project keeps the same join link on this device, so a QR code handed out earlier keeps
 * working after the host reloads, and returning guests keep their identity (and their votes).
 */
export function hostCredentialsFor(projectKey: string): SessionCredentials {
  const key = HOST_KEY_PREFIX + projectKey;
  const raw = read(key);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as SessionCredentials;
      if (saved.sessionId && saved.secret) return saved;
    } catch {
      // regenerate below
    }
  }
  const creds = createSessionCredentials();
  write(key, JSON.stringify(creds));
  return creds;
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
