import { type Server, createServer } from "node:http";
import { serve } from "@hono/node-server";
import { type WebSocket, WebSocketServer } from "ws";
import { type RelayServerOptions, createRelayApp, randomId } from "./app.js";
import { LiveSubscribeSchema, liveSubscribeBody, tunnelHelloBody } from "./protocol.js";

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

      // 1. WS /v1/docs/:docId/live — the first message must be a signed `subscribe` from a
      // current ACL member; one subscription per connection, capped per doc.
      const liveMatch = path.match(/^\/v1\/docs\/([^/]+)\/live$/);
      if (liveMatch) {
        const docId = liveMatch[1];
        if (!docId) {
          ws.close(1008, "Invalid docId");
          return;
        }
        let subscribed = false;
        let listener: ((seq: number) => void) | undefined;
        const reject = (reason: string) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", error: reason }));
          ws.close(1008, reason);
        };
        const authTimer = setTimeout(() => {
          if (!subscribed) reject("Authentication timeout");
        }, relay.limits.liveAuthTimeoutMs);

        ws.on("message", (raw) => {
          if (subscribed) {
            // Nothing else is accepted on a live socket (no further subscriptions).
            reject("Only one subscription per connection");
            return;
          }
          let parsed: ReturnType<typeof LiveSubscribeSchema.safeParse>;
          try {
            parsed = LiveSubscribeSchema.safeParse(JSON.parse(raw.toString()));
          } catch {
            reject("Malformed message");
            return;
          }
          if (!parsed.success) {
            reject("Expected signed subscribe message");
            return;
          }
          const msg = parsed.data;
          const verify = relay.verifySigned(
            "WS",
            `${path}${url.search}`,
            String(msg.timestamp),
            msg.nonce,
            msg.signature,
            msg.key,
            liveSubscribeBody(docId)
          );
          if (!verify.valid) {
            reject(verify.error ?? "Authentication failed");
            return;
          }
          if (!relay.memberRole(docId, msg.key)) {
            reject("Signer is not an ACL member");
            return;
          }
          let subs = relay.liveSubscribers.get(docId);
          if (!subs) {
            subs = new Set();
            relay.liveSubscribers.set(docId, subs);
          }
          if (subs.size >= relay.limits.maxLiveSubscribersPerDoc) {
            reject("Too many live subscribers for this document");
            return;
          }

          subscribed = true;
          clearTimeout(authTimer);
          const key = msg.key;
          const docSubs = subs;
          const current = (seq: number) => {
            // Re-check membership, so a member removed from the ACL stops receiving events.
            if (!relay.memberRole(docId, key)) {
              docSubs.delete(current);
              reject("No longer an ACL member");
              return;
            }
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "live", docId, seq }));
            }
          };
          listener = current;
          docSubs.add(current);
          ws.send(JSON.stringify({ type: "subscribed", docId }));
        });

        ws.on("close", () => {
          clearTimeout(authTimer);
          const subs = relay.liveSubscribers.get(docId);
          if (subs && listener) {
            subs.delete(listener);
            if (subs.size === 0) relay.liveSubscribers.delete(docId);
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
              const { key, timestamp, nonce, signature } = data;
              const verify = relay.verifySigned(
                "WS",
                "/v1/tunnels",
                String(timestamp),
                typeof nonce === "string" ? nonce : undefined,
                signature,
                key,
                tunnelHelloBody()
              );

              if (!verify.valid) {
                ws.send(JSON.stringify({ error: "Invalid hello signature" }));
                ws.close(1008, "Authentication failed");
                return;
              }

              authenticated = true;
              tunnelId = randomId("tun");
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
