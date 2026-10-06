import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { AuditLog } from "./agent-api/audit.js";
import { GrantManager } from "./agent-api/grants.js";
import { createMcpServer } from "./agent-api/mcp.js";
import { createRestRouter } from "./agent-api/rest.js";
import { AgentStateStore } from "./agent-api/state.js";

export interface NodeServerOptions {
  grantManager?: GrantManager;
  stateStore?: AgentStateStore;
  auditLog?: AuditLog;
  allowedHosts?: (string | RegExp)[];
}

export function createNodeApp(options?: NodeServerOptions): {
  app: Hono;
  grantManager: GrantManager;
  stateStore: AgentStateStore;
  auditLog: AuditLog;
} {
  const auditLog = options?.auditLog || new AuditLog();
  const grantManager = options?.grantManager || new GrantManager(auditLog);
  const stateStore = options?.stateStore || new AgentStateStore();

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
  const restRouter = createRestRouter({ grantManager, stateStore });
  app.route("/api/v1", restRouter);

  // MCP Streamable HTTP endpoint mounted under /mcp
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

  return { app, grantManager, stateStore, auditLog };
}

export function startNodeServer(opts?: { port?: number; hostname?: string } & NodeServerOptions) {
  const port = opts?.port ?? 4178;
  const hostname = opts?.hostname ?? "127.0.0.1";
  const { app, grantManager, stateStore, auditLog } = createNodeApp(opts);

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  return { server, app, grantManager, stateStore, auditLog, port, hostname };
}
