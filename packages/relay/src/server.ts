import { type Server, createServer } from "node:http";
import { verifyRequestSignature } from "@decisionator/core";
import { serve } from "@hono/node-server";
import { type WebSocket, WebSocketServer } from "ws";
import { type RelayServerOptions, createRelayApp } from "./app.js";

export interface RelayService {
  app: ReturnType<typeof createRelayApp>["app"];
  db: ReturnType<typeof createRelayApp>["db"];
  server: Server;
  close: () => Promise<void>;
  port: number;
}

export function startRelayServer(
  options: RelayServerOptions & { port?: number } = {}
): Promise<RelayService> {
  return new Promise((resolve) => {
    const relay = createRelayApp(options);
    const requestedPort = options.port ?? 0;

    const server = serve({
      fetch: relay.app.fetch,
      port: requestedPort,
    }) as Server;

    const wss = new WebSocketServer({ server });

    wss.on("connection", (ws: WebSocket, req) => {
      const url = new URL(req.url || "", `http://${req.headers.host || "127.0.0.1"}`);
      const path = url.pathname;

      // 1. WS /v1/docs/:docId/live
      const liveMatch = path.match(/^\/v1\/docs\/([^/]+)\/live$/);
      if (liveMatch) {
        const docId = liveMatch[1];
        if (!docId) {
          ws.close(1008, "Invalid docId");
          return;
        }
        let subs = relay.liveSubscribers.get(docId);
        if (!subs) {
          subs = new Set();
          relay.liveSubscribers.set(docId, subs);
        }

        const listener = (seq: number) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "live", docId, seq }));
          }
        };

        subs.add(listener);
        ws.on("close", () => {
          subs.delete(listener);
          if (subs.size === 0) {
            relay.liveSubscribers.delete(docId);
          }
        });
        return;
      }

      // 2. WS /v1/tunnels
      if (path === "/v1/tunnels") {
        let authenticated = false;
        let tunnelId = "";

        const pendingRequests = new Map<
          string,
          (res: { status: number; headers: Record<string, string>; body: string }) => void
        >();

        ws.on("message", (raw) => {
          try {
            const data = JSON.parse(raw.toString());

            // First message: signed hello
            if (!authenticated && data.type === "hello") {
              const { key, timestamp, signature } = data;
              const verify = verifyRequestSignature(
                "WS",
                "/v1/tunnels",
                String(timestamp),
                signature,
                key,
                new TextEncoder().encode(JSON.stringify({ type: "hello" }))
              );

              if (!verify.valid) {
                ws.send(JSON.stringify({ error: "Invalid hello signature" }));
                ws.close(1008, "Authentication failed");
                return;
              }

              authenticated = true;
              tunnelId = `tun_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
              relay.tunnels.set(tunnelId, {
                send: (msg) => {
                  if (ws.readyState === ws.OPEN) ws.send(msg);
                },
                pendingRequests,
              });

              ws.send(JSON.stringify({ type: "ready", tunnelId }));
              return;
            }

            // Subsequent messages: tunnel response
            if (data.type === "tunnel_response") {
              const pending = pendingRequests.get(data.requestId);
              if (pending) {
                pendingRequests.delete(data.requestId);
                pending({
                  status: data.status,
                  headers: data.headers || {},
                  body: data.body || "",
                });
              }
            }
          } catch {
            ws.send(JSON.stringify({ error: "Malformed message" }));
          }
        });

        ws.on("close", () => {
          if (tunnelId) {
            relay.tunnels.delete(tunnelId);
          }
        });
        return;
      }

      ws.close(1000, "Unknown WS endpoint");
    });

    server.on("listening", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : requestedPort;
      resolve({
        app: relay.app,
        db: relay.db,
        server,
        port: actualPort,
        close: () =>
          new Promise<void>((resClose) => {
            wss.close(() => {
              server.close(() => {
                relay.db.close();
                resClose();
              });
            });
          }),
      });
    });
  });
}
