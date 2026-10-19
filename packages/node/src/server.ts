import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AuditLog } from "./agent-api/audit.js";
import { GrantManager } from "./agent-api/grants.js";
import { createMcpServer } from "./agent-api/mcp.js";
import { OwnerAuth } from "./agent-api/owner.js";
import { createRestRouter } from "./agent-api/rest.js";
import { REQUEST_BODY_MAX_BYTES } from "./agent-api/schemas.js";
import { AgentStateStore } from "./agent-api/state.js";

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
    const authHeader = c.req.header("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1] ? match[1].trim() : "";

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
  const { app, grantManager, stateStore, auditLog, ownerToken } = createNodeApp({
    ...opts,
    ownerToken: opts?.ownerToken ?? (process.env.DECISIONATOR_OWNER_TOKEN || undefined),
  });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  return { server, app, grantManager, stateStore, auditLog, ownerToken, port, hostname };
}
