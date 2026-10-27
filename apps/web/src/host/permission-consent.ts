import { parseNetPermission } from "./sandbox/csp.js";

/**
 * Plugin permission consent (plugin runtime 1.2.0, F12).
 *
 * A manifest only *requests* permissions. The host grants them when either
 * - the plugin is a first-party built-in listed in `FIRST_PARTY_PERMISSIONS` and asks for no
 *   more than its listed set, or
 * - the person approved exactly this plugin id, version and permission set (consent is stored
 *   per that triple, so an update that asks for more, or a new version, asks again).
 * Everything else is denied by default: the plugin runs with no permissions (no network, no
 * OAuth, no project or clipboard access).
 *
 * Malformed permissions (e.g. `net:*`, `net:http://…`, paths, quotes) are never granted.
 */

/** What a plugin asks for, as shown to the person. */
export interface PermissionRequest {
  pluginId: string;
  pluginName: string;
  version: string;
  permissions: string[];
}

/** Asks the person whether to grant `request.permissions`; true grants all of them. */
export type ConsentPrompt = (request: PermissionRequest) => boolean | Promise<boolean>;

/** Where approvals are remembered. */
export interface ConsentStore {
  has(key: string): boolean;
  add(key: string): void;
  remove(key: string): void;
}

/**
 * First-party built-ins and the most they may be granted without asking. Listed explicitly (not
 * by id prefix) so a third-party manifest cannot claim more by naming itself `org.decisionator.*`.
 */
export const FIRST_PARTY_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "org.decisionator.strategy.borda": [],
  "org.decisionator.strategy.random": [],
  "org.decisionator.strategy.weighted": [],
  "org.decisionator.strategy.owner-pick": [],
  "org.decisionator.source.paste": [],
  "org.decisionator.option-status": [],
  "org.decisionator.source.google-docs": ["oauth:google-drive", "net:https://docs.googleapis.com"],
  "org.decisionator.store.google-sheets": [
    "oauth:google",
    "net:https://www.googleapis.com",
    "net:https://sheets.googleapis.com",
  ],
  "org.decisionator.store.firestore": [
    "net:https://firestore.googleapis.com",
    "net:https://identitytoolkit.googleapis.com",
  ],
  "org.decisionator.store.file": ["filesystem:read", "filesystem:write"],
};

const SIMPLE_PERMISSIONS = new Set([
  "clipboard:read",
  "project:read",
  "ideas:write",
  "filesystem:read",
  "filesystem:write",
]);

/** Whether a permission string is well-formed (and therefore grantable at all). */
export function isWellFormedPermission(permission: string): boolean {
  if (SIMPLE_PERMISSIONS.has(permission)) return true;
  if (permission.startsWith("net:")) return parseNetPermission(permission) !== null;
  return /^oauth:[a-z0-9-]{1,64}$/.test(permission);
}

/** Requested permissions, de-duplicated and with malformed ones dropped, in a stable order. */
export function normalizePermissions(requested: readonly string[] | undefined): string[] {
  return [...new Set((requested ?? []).filter((p) => isWellFormedPermission(p)))].sort();
}

/** The key consent is stored under: plugin id, version and the exact permission set. */
export function consentKey(pluginId: string, version: string, permissions: readonly string[]) {
  return `${pluginId}@${version}#${[...permissions].sort().join(",")}`;
}

const STORAGE_KEY = "deci.pluginConsent.v1";

/** Consent remembered in this browser (`localStorage`); falls back to memory when unavailable. */
export function browserConsentStore(): ConsentStore {
  const memory = new Set<string>();
  const read = (): Set<string> => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
    } catch {
      return memory;
    }
  };
  const write = (keys: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    } catch {
      // Storage unavailable: memory only.
    }
  };
  return {
    has: (key) => read().has(key) || memory.has(key),
    add: (key) => {
      memory.add(key);
      const keys = read();
      keys.add(key);
      write(keys);
    },
    remove: (key) => {
      memory.delete(key);
      const keys = read();
      keys.delete(key);
      write(keys);
    },
  };
}

/** An in-memory store (tests, or hosts without persistence). */
export function memoryConsentStore(): ConsentStore {
  const keys = new Set<string>();
  return {
    has: (key) => keys.has(key),
    add: (key) => void keys.add(key),
    remove: (key) => void keys.delete(key),
  };
}

/** Plain-language description of a permission for the consent dialog. */
export function describePermission(permission: string): string {
  if (permission.startsWith("net:")) return `Connect to ${permission.slice(4)}`;
  if (permission.startsWith("oauth:")) return `Sign in to ${permission.slice(6)} on your behalf`;
  switch (permission) {
    case "clipboard:read":
      return "Read your clipboard";
    case "project:read":
      return "Read the current project";
    case "ideas:write":
      return "Add ideas";
    case "filesystem:read":
      return "Read files you pick";
    case "filesystem:write":
      return "Write files you pick";
    default:
      return permission;
  }
}

/**
 * Minimal consent UI: a native confirm dialog listing the requested permissions. Denies when no
 * dialog is available (e.g. outside a browser).
 */
export const confirmConsentPrompt: ConsentPrompt = (request) => {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  const lines = request.permissions.map((p) => `• ${describePermission(p)}`).join("\n");
  return window.confirm(
    `Allow the plugin "${request.pluginName}" (${request.pluginId} ${request.version}) to:\n\n${lines}\n\nOnly allow plugins you trust.`
  );
};

export interface PermissionConsentOptions {
  store?: ConsentStore;
  /** Asked by `request()`; default `confirmConsentPrompt`. */
  prompt?: ConsentPrompt;
  /** First-party allowlist; default `FIRST_PARTY_PERMISSIONS`. */
  firstParty?: Readonly<Record<string, readonly string[]>>;
}

interface ManifestLike {
  id: string;
  name: string;
  version: string;
  permissions?: string[];
}

export class PermissionConsent {
  private readonly store: ConsentStore;
  private readonly prompt: ConsentPrompt;
  private readonly firstParty: Readonly<Record<string, readonly string[]>>;

  constructor(options: PermissionConsentOptions = {}) {
    this.store = options.store ?? browserConsentStore();
    this.prompt = options.prompt ?? confirmConsentPrompt;
    this.firstParty = options.firstParty ?? FIRST_PARTY_PERMISSIONS;
  }

  /** Whether the built-in allowlist covers every permission this manifest requests. */
  isPreapproved(manifest: ManifestLike): boolean {
    const allowed = this.firstParty[manifest.id];
    if (!allowed) return false;
    return normalizePermissions(manifest.permissions).every((p) => allowed.includes(p));
  }

  /**
   * The permissions to grant now, without asking: the requested (well-formed) set when it is
   * pre-approved or was approved before, otherwise none (deny by default).
   */
  granted(manifest: ManifestLike): string[] {
    const requested = normalizePermissions(manifest.permissions);
    if (requested.length === 0) return [];
    if (this.isPreapproved(manifest)) return requested;
    return this.store.has(consentKey(manifest.id, manifest.version, requested)) ? requested : [];
  }

  /**
   * Asks the person (once per id, version and permission set) and returns what to grant. A
   * refusal grants nothing and is not remembered, so the plugin can ask again later.
   */
  async request(manifest: ManifestLike): Promise<string[]> {
    const already = this.granted(manifest);
    const requested = normalizePermissions(manifest.permissions);
    if (requested.length === 0 || already.length > 0) return already;
    const ok = await this.prompt({
      pluginId: manifest.id,
      pluginName: manifest.name,
      version: manifest.version,
      permissions: requested,
    });
    if (!ok) return [];
    this.store.add(consentKey(manifest.id, manifest.version, requested));
    return requested;
  }

  /** Forgets an approval, so the plugin runs without permissions until approved again. */
  revoke(manifest: ManifestLike): void {
    this.store.remove(
      consentKey(manifest.id, manifest.version, normalizePermissions(manifest.permissions))
    );
  }
}
