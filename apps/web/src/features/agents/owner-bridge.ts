import { useSyncExternalStore } from "react";

/**
 * The owner's link to the local Deci node (agentic API 1.4.0, owner bridge).
 *
 * The node's owner token is never part of the app bundle. The node prints (or its starter hands
 * out) the token; the owner pastes it into this tab. It is kept in memory and, so a reload does
 * not lose it, in `sessionStorage` of this tab only: never `localStorage`, never a URL. Without a
 * token the bridge is disabled and no request is sent.
 */

export const DEFAULT_NODE_URL = "http://127.0.0.1:4178";

/** Shortest owner token the node accepts (`OWNER_TOKEN_MIN_LENGTH` in packages/node). */
export const OWNER_TOKEN_MIN_LENGTH = 32;

const SESSION_KEY = "deci.ownerBridgeToken";

type Listener = () => void;
const listeners = new Set<Listener>();
let memoryToken: string | null | undefined;

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Why a pasted token is refused, or null when it looks like an owner token. */
export function ownerTokenProblem(token: string): string | null {
  if (token.length < OWNER_TOKEN_MIN_LENGTH) {
    return `The owner token has at least ${OWNER_TOKEN_MIN_LENGTH} characters.`;
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    return "The owner token has no spaces or special characters.";
  }
  return null;
}

/** The owner token of this tab, or null when none was entered. */
export function getOwnerToken(): string | null {
  if (memoryToken === undefined) {
    let stored: string | null = null;
    try {
      stored = session()?.getItem(SESSION_KEY) ?? null;
    } catch {
      stored = null;
    }
    memoryToken = stored && !ownerTokenProblem(stored) ? stored : null;
  }
  return memoryToken;
}

/** Sets (or, with null, forgets) the owner token of this tab. Throws on a malformed token. */
export function setOwnerToken(token: string | null): void {
  const value = token?.trim() || null;
  if (value) {
    const problem = ownerTokenProblem(value);
    if (problem) throw new Error(problem);
  }
  memoryToken = value;
  try {
    const store = session();
    if (value) store?.setItem(SESSION_KEY, value);
    else store?.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable: keep the token in memory only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The owner token of this tab, re-rendering when it changes. */
export function useOwnerToken(): string | null {
  return useSyncExternalStore(subscribe, getOwnerToken, () => null);
}

export class OwnerBridgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "OwnerBridgeError";
  }
}

/**
 * Calls an owner-only node route with the owner token. Refuses (without any request) when no
 * token is configured.
 */
export async function ownerBridgeFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
  options: { nodeUrl?: string; token?: string | null; fetchImpl?: typeof fetch } = {}
): Promise<Response> {
  const token = options.token === undefined ? getOwnerToken() : options.token;
  if (!token) {
    throw new OwnerBridgeError("Connect the local node first: enter its owner token.");
  }
  const base = (options.nodeUrl ?? DEFAULT_NODE_URL).replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await doFetch(`${base}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "omit",
    cache: "no-store",
  });
  if (res.status === 401) {
    throw new OwnerBridgeError(
      "The local node refused the owner token. Paste the token it printed when it started.",
      401,
      "UNAUTHORIZED"
    );
  }
  return res;
}

export type AgentTarget = { kind: "project" } | { kind: "option"; optionId: string };
export type AgentPermission = "read" | "contribute" | "propose_options" | "moderate_session";

export interface MintedGrant {
  id: string;
  token: string;
  projectId: string;
  target: AgentTarget;
  permissions: AgentPermission[];
  expiresAt: string;
}

/** Mints a scoped, expiring agent grant through the owner bridge (`POST /grants`). */
export async function createAgentGrant(
  input: {
    projectId: string;
    instruction: string;
    target: AgentTarget;
    permissions: AgentPermission[];
    lifetimeHours?: number;
  },
  options?: Parameters<typeof ownerBridgeFetch>[2]
): Promise<MintedGrant> {
  const res = await ownerBridgeFetch("/grants", { method: "POST", body: input }, options);
  const data = (await res.json().catch(() => ({}))) as Partial<MintedGrant> & {
    message?: string;
    error?: string;
  };
  if (res.status !== 201 || typeof data.token !== "string" || typeof data.id !== "string") {
    throw new OwnerBridgeError(
      data.message ?? `The local node could not create the access (${res.status}).`,
      res.status,
      data.error
    );
  }
  return data as MintedGrant;
}

/** Revokes an agent grant through the owner bridge (`DELETE /grants/{id}`). */
export async function revokeAgentGrant(
  id: string,
  options?: Parameters<typeof ownerBridgeFetch>[2]
): Promise<void> {
  const res = await ownerBridgeFetch(
    `/grants/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    options
  );
  if (!res.ok && res.status !== 404) {
    throw new OwnerBridgeError(`The local node could not revoke the access (${res.status}).`);
  }
}
