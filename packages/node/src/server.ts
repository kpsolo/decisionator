import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { AuditLog } from "./agent-api/audit.js";
import { GrantManager } from "./agent-api/grants.js";
import { createMcpServer } from "./agent-api/mcp.js";
import { OwnerAuth } from "./agent-api/owner.js";
import { createRestRouter } from "./agent-api/rest.js";
import { REQUEST_BODY_MAX_BYTES } from "./agent-api/schemas.js";
import { AgentStateStore } from "./agent-api/state.js";
import { AuthFailureThrottle } from "./agent-api/throttle.js";

/**
 * Browser origins that may call the node by default: the Vite dev server and preview on this
 * machine. The hosted app's origin is added with `allowedOrigins` /
 * `DECISIONATOR_ALLOWED_ORIGINS`.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

/** The client a request comes from (its socket address), for throttling. */
function clientKey(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // In-memory requests (tests) have no socket.
    return "local";
  }
}

const bearerToken = (header: string | undefined): string => {
  const match = (header ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] ? match[1].trim() : "";
};

export interface NodeServerOptions {
  grantManager?: GrantManager;
  stateStore?: AgentStateStore;
  auditLog?: AuditLog;
  allowedHosts?: (string | RegExp)[];
  /**
   * The owner's bridge credential (at least 32 characters). The owner's hosting tab sends it as
   * the bearer token of the owner-only live-session routes. When omitted, `startNodeServer` reads
   * `DECISIONATOR_OWNER_TOKEN`, and otherwise a random token is generated and returned as
   * `ownerToken` for the owner's app. Agent grant tokens are never accepted there.
   */
  ownerToken?: string;
  /**
   * Browser origins allowed to call the node (CORS), e.g. the hosted app. Defaults to
   * `DEFAULT_ALLOWED_ORIGINS`. Requests without an `Origin` (agents, CLI) are unaffected.
   */
  allowedOrigins?: readonly string[];
  /** Throttle for invalid tokens (default: 20 failures per minute per client). */
  authFailureThrottle?: AuthFailureThrottle;
}

export function createNodeApp(options?: NodeServerOptions): {
  app: Hono;
  grantManager: GrantManager;
  stateStore: AgentStateStore;
  auditLog: AuditLog;
  /** The owner's bridge credential; hand it only to the owner's app. */
  ownerToken: string;
} {
  const auditLog = options?.auditLog || new AuditLog();
  const grantManager = options?.grantManager || new GrantManager(auditLog);
  const stateStore = options?.stateStore || new AgentStateStore();
  const ownerAuth = new OwnerAuth(options?.ownerToken);
  const throttle = options?.authFailureThrottle ?? new AuthFailureThrottle();
  const allowedOrigins = new Set(options?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);

  // Forgotten grants take their pseudonym maps and request index with them.
  grantManager.onPrune((ids) => stateStore.forgetGrants(ids));

  const app = new Hono();

  // DNS Rebinding Defense (R14): Verify Host header
  app.use("*", async (c, next) => {
    const host = c.req.header("host") || "";
    // Allow empty host (e.g. mock/in-memory test calls) or localhost/127.0.0.1
    const isAllowedHost =
      !host ||
      /^127\.0\.0\.1(:\d+)?$/.test(host) ||
      /^localhost(:\d+)?$/.test(host) ||
      options?.allowedHosts?.some((h) => (typeof h === "string" ? h === host : h.test(host)));

    if (!isAllowedHost) {
      return c.json(
        {
          error: "FORBIDDEN_HOST",
          message: "Invalid Host header (DNS rebinding defense active)",
        },
        403
      );
    }

    return next();
  });

  // Only listed browser origins may read responses (the owner's tab uses the owner bridge).
  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-Agent-Name", "Mcp-Session-Id"],
      maxAge: 600,
    })
  );

  // Invalid-token throttle (1.4.0): too many 401s from one client get 429 for the rest of the
  // window. The owner token always passes, so a noisy local agent cannot lock the owner out.
  const throttled = (c: Context) => {
    if (c.req.method === "OPTIONS") return null;
    const key = clientKey(c);
    if (!throttle.isBlocked(key)) return null;
    if (ownerAuth.verify(bearerToken(c.req.header("authorization")))) return null;
    c.header("Retry-After", String(throttle.retryAfterSeconds(key)));
    return c.json(
      { error: "RATE_LIMITED", message: "Too many invalid tokens; try again later" },
      429
    );
  };
  app.use("/api/v1/*", async (c, next) => {
    const blocked = throttled(c);
    if (blocked) return blocked;
    await next();
    if (c.res.status === 401) throttle.recordFailure(clientKey(c));
  });

  // REST API mounted under /api/v1
  const restRouter = createRestRouter({ grantManager, stateStore, ownerAuth });
  app.route("/api/v1", restRouter);

  // MCP Streamable HTTP endpoint mounted under /mcp
  app.use(
    "/mcp",
    bodyLimit({
      maxSize: REQUEST_BODY_MAX_BYTES,
      onError: (c) =>
        c.json(
          { error: "TOO_LARGE", message: `Request body exceeds ${REQUEST_BODY_MAX_BYTES} bytes` },
          413
        ),
    })
  );
  app.all("/mcp", async (c) => {
    const blocked = throttled(c);
    if (blocked) return blocked;
    // The grant token comes only from the Authorization header, never from the JSON-RPC body.
    const token = bearerToken(c.req.header("authorization"));
    if (token && !grantManager.resolveGrantByToken(token)) {
      throttle.recordFailure(clientKey(c));
    }

    const mcpServer = createMcpServer({
      grantManager,
      stateStore,
      defaultToken: token,
    });

    const transport = new WebStandardStreamableHTTPServerTransport();
    await mcpServer.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return { app, grantManager, stateStore, auditLog, ownerToken: ownerAuth.token };
}

export function startNodeServer(opts?: { port?: number; hostname?: string } & NodeServerOptions) {
  const port = opts?.port ?? 4178;
  const hostname = opts?.hostname ?? "127.0.0.1";
  const envOrigins = (process.env.DECISIONATOR_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const { app, grantManager, stateStore, auditLog, ownerToken } = createNodeApp({
    ...opts,
    ownerToken: opts?.ownerToken ?? (process.env.DECISIONATOR_OWNER_TOKEN || undefined),
    allowedOrigins: opts?.allowedOrigins ?? [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins],
  });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  return { server, app, grantManager, stateStore, auditLog, ownerToken, port, hostname };
}
