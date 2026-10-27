import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../src/agent-api/audit.js";
import { GrantManager } from "../src/agent-api/grants.js";
import { createMcpServer } from "../src/agent-api/mcp.js";
import { AgentStateStore } from "../src/agent-api/state.js";
import { AuthFailureThrottle } from "../src/agent-api/throttle.js";
import { createNodeApp } from "../src/server.js";

const OWNER_TOKEN = "owner-token-for-tests-0123456789abcdef";

const project = {
  title: "Trip",
  options: [
    {
      id: "opt_1",
      title: "Lisbon",
      description: "",
      status: "active" as const,
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
  ],
  ideas: [{ id: "idea_1", text: "Somewhere warm" }],
  contributions: [],
  sourceRefs: [],
};

describe("Agent API 1.4.0 security", () => {
  let auditLog: AuditLog;
  let grantManager: GrantManager;
  let stateStore: AgentStateStore;
  let app: ReturnType<typeof createNodeApp>["app"];

  beforeEach(() => {
    auditLog = new AuditLog();
    grantManager = new GrantManager(auditLog);
    stateStore = new AgentStateStore();
    app = createNodeApp({ grantManager, stateStore, auditLog, ownerToken: OWNER_TOKEN }).app;
    stateStore.setProject("proj_1", project);
  });

  const call = (
    path: string,
    bearer: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {}
  ) =>
    app.request(`/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      body: init.body,
    });

  const grantBody = JSON.stringify({
    projectId: "proj_1",
    instruction: "Research the options",
    permissions: ["read", "contribute"],
  });

  describe("POST /grants (owner only)", () => {
    it("mints a grant for the owner and returns the token once", async () => {
      const res = await call("/grants", OWNER_TOKEN, { method: "POST", body: grantBody });
      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const data = (await res.json()) as { id: string; token: string; target: unknown };
      expect(data.token).toMatch(/^[0-9a-f]{64}$/);
      expect(data.target).toEqual({ kind: "project" });
      expect(grantManager.getGrant(data.id)?.tokenHash).not.toContain(data.token);
      expect(auditLog.getEvents().some((e) => e.type === "agent_grant_created")).toBe(true);

      // The minted token works as an agent token...
      const req = await call("/request", data.token);
      expect(req.status).toBe(200);
      expect((await req.json()).projectId).toBe("proj_1");
      // ...but never as the owner.
      expect((await call("/grants", data.token, { method: "POST", body: grantBody })).status).toBe(
        403
      );
    });

    it("refuses agents (403) and anyone else (401)", async () => {
      const { token } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "x",
        target: { kind: "project" },
        permissions: ["read", "contribute", "propose_options", "moderate_session"],
      });
      const before = grantManager.size;
      const asAgent = await call("/grants", token, { method: "POST", body: grantBody });
      expect(asAgent.status).toBe(403);
      expect((await asAgent.json()).error).toBe("NOT_PERMITTED_FOR_AGENTS");
      expect((await call("/grants", "nope", { method: "POST", body: grantBody })).status).toBe(401);
      expect((await call("/grants", "", { method: "POST", body: grantBody })).status).toBe(401);
      expect(grantManager.size).toBe(before);
    });

    it("validates the body", async () => {
      for (const bad of [
        "{not json",
        "[]",
        JSON.stringify({ projectId: "proj_1", instruction: "x", permissions: [] }),
        JSON.stringify({ projectId: "proj_1", instruction: "x", permissions: ["admin"] }),
        JSON.stringify({ projectId: "proj_1", instruction: "x", permissions: ["read", "read"] }),
        JSON.stringify({ projectId: "", instruction: "x", permissions: ["read"] }),
        JSON.stringify({
          projectId: "proj_1",
          instruction: "x",
          permissions: ["read"],
          lifetimeHours: 24 * 31,
        }),
        JSON.stringify({ projectId: "proj_1", instruction: "x", permissions: ["read"], extra: 1 }),
      ]) {
        const res = await call("/grants", OWNER_TOKEN, { method: "POST", body: bad });
        expect(res.status, bad).toBe(400);
      }
    });

    it("lets the owner revoke a grant", async () => {
      const created = await call("/grants", OWNER_TOKEN, { method: "POST", body: grantBody });
      const { id, token } = (await created.json()) as { id: string; token: string };
      expect((await call(`/grants/${id}`, token, { method: "DELETE" })).status).toBe(403);
      expect((await call(`/grants/${id}`, OWNER_TOKEN, { method: "DELETE" })).status).toBe(200);
      const after = await call("/request", token);
      expect(after.status).toBe(401);
      expect((await after.json()).error).toBe("REVOKED");
      expect((await call("/grants/req_unknown", OWNER_TOKEN, { method: "DELETE" })).status).toBe(
        404
      );
    });
  });

  describe("add_contribution targets must exist (F14)", () => {
    const contributor = () =>
      grantManager.createGrant({
        projectId: "proj_1",
        instruction: "x",
        target: { kind: "project" },
        permissions: ["read", "contribute"],
      }).token;

    it("REST: 404 for an unknown option or idea, 201 for existing ones", async () => {
      const token = contributor();
      const post = (target: unknown) =>
        call("/contributions", token, {
          method: "POST",
          body: JSON.stringify({ target, type: "note", body: "Hi" }),
        });
      for (const target of [
        { kind: "option", optionId: "opt_missing" },
        { kind: "idea", ideaId: "idea_missing" },
      ]) {
        const res = await post(target);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("NOT_FOUND");
      }
      expect(
        stateStore.getOwnContributions(grantManager.resolveGrantByToken(token)?.id ?? "")
      ).toEqual([]);
      expect((await post({ kind: "option", optionId: "opt_1" })).status).toBe(201);
      expect((await post({ kind: "idea", ideaId: "idea_1" })).status).toBe(201);
      expect((await post({ kind: "project" })).status).toBe(201);
    });

    it("MCP: tool error for an unknown option", async () => {
      const token = contributor();
      const server = createMcpServer({ grantManager, stateStore, defaultToken: token });
      const client = new Client({ name: "t", version: "1.0.0" });
      const [c, s] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(s), client.connect(c)]);
      const res = await client.callTool({
        name: "add_contribution",
        arguments: { target: { kind: "option", optionId: "opt_missing" }, type: "note", body: "x" },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("[404] NOT_FOUND");
      const ok = await client.callTool({
        name: "add_contribution",
        arguments: { target: { kind: "option", optionId: "opt_1" }, type: "note", body: "x" },
      });
      expect(ok.isError).toBeFalsy();
      await client.close();
    });
  });

  describe("MCP token source (F15)", () => {
    it("ignores a grant token supplied in the JSON-RPC body (_meta)", async () => {
      const { token } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "x",
        target: { kind: "project" },
        permissions: ["read"],
      });
      const server = createMcpServer({ grantManager, stateStore });
      const client = new Client({ name: "t", version: "1.0.0" });
      const [c, s] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(s), client.connect(c)]);
      const res = await client.callTool({ name: "get_request", arguments: {}, _meta: { token } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("[401] UNAUTHORIZED");
      await client.close();
    });
  });

  describe("grant pruning (F15)", () => {
    it("forgets ended grants and their pseudonyms after the retention period", () => {
      let now = Date.parse("2026-10-27T12:00:00Z");
      const gm = new GrantManager(undefined, { retentionMs: 1000, now: () => now });
      const store = new AgentStateStore();
      gm.onPrune((ids) => store.forgetGrants(ids));
      const make = () =>
        gm.createGrant({
          projectId: "p",
          instruction: "x",
          target: { kind: "project" },
          permissions: ["read"],
          lifetimeHours: 1,
        });
      const revoked = make();
      const completed = make();
      const live = make();
      gm.revokeGrant(revoked.grant.id);
      gm.completeRequest(completed.grant.id);
      const pseudo = store.getPseudonym(revoked.grant.id, "guest:a");
      expect(store.resolvePseudonym(revoked.grant.id, pseudo)).toBe("guest:a");

      now += 500;
      expect(gm.prune()).toEqual([]);
      now += 1000;
      expect(gm.prune().sort()).toEqual([revoked.grant.id, completed.grant.id].sort());
      expect(gm.resolveGrantByToken(revoked.token)).toBeUndefined();
      expect(store.resolvePseudonym(revoked.grant.id, pseudo)).toBeUndefined();
      expect(gm.resolveGrantByToken(live.token)?.id).toBe(live.grant.id);

      // Expired grants go once their expiry is older than the retention period.
      now += 3600_000 + 2000;
      expect(gm.prune()).toEqual([live.grant.id]);
      expect(gm.size).toBe(0);
    });

    it("prunes automatically on access", () => {
      let now = Date.parse("2026-10-27T12:00:00Z");
      const gm = new GrantManager(undefined, {
        retentionMs: 0,
        pruneIntervalMs: 0,
        now: () => now,
      });
      const { grant } = gm.createGrant({
        projectId: "p",
        instruction: "x",
        target: { kind: "project" },
        permissions: ["read"],
      });
      gm.revokeGrant(grant.id);
      now += 1;
      gm.resolveGrantByToken("anything");
      expect(gm.getGrant(grant.id)).toBeUndefined();
    });
  });

  describe("invalid-token throttle (F15)", () => {
    it("answers 429 after too many invalid tokens, but lets the owner through", async () => {
      const throttled = createNodeApp({
        grantManager,
        stateStore,
        ownerToken: OWNER_TOKEN,
        authFailureThrottle: new AuthFailureThrottle({ maxFailures: 3 }),
      }).app;
      const req = (bearer: string) =>
        throttled.request("/api/v1/request", { headers: { Authorization: `Bearer ${bearer}` } });
      for (let i = 0; i < 3; i++) expect((await req(`guess-${i}`)).status).toBe(401);
      const blocked = await req("guess-4");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();

      const { token } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "x",
        target: { kind: "project" },
        permissions: ["read"],
      });
      expect((await req(token)).status).toBe(429);
      const owner = await throttled.request("/api/v1/live-session/proposals?projectId=proj_1", {
        headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
      });
      expect(owner.status).toBe(200);
    });

    it("opens again after the window", () => {
      let now = 0;
      const t = new AuthFailureThrottle({ maxFailures: 2, windowMs: 1000, now: () => now });
      t.recordFailure("a");
      t.recordFailure("a");
      expect(t.isBlocked("a")).toBe(true);
      expect(t.isBlocked("b")).toBe(false);
      now = 1000;
      expect(t.isBlocked("a")).toBe(false);
    });
  });

  describe("CORS", () => {
    it("allows only listed origins", async () => {
      const preflight = (origin: string) =>
        app.request("/api/v1/grants", {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
          },
        });
      const ok = await preflight("http://localhost:5173");
      expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      const evil = await preflight("https://evil.example");
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
