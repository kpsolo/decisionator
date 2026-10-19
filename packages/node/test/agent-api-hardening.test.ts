import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../src/agent-api/audit.js";
import { GrantManager } from "../src/agent-api/grants.js";
import { createMcpServer } from "../src/agent-api/mcp.js";
import { OwnerAuth } from "../src/agent-api/owner.js";
import { AgentStateStore } from "../src/agent-api/state.js";
import { createNodeApp } from "../src/server.js";

type Permission = "read" | "contribute" | "propose_options" | "moderate_session";
type Target = { kind: "project" } | { kind: "option"; optionId: string };

const OWNER_TOKEN = "owner-token-for-tests-0123456789abcdef";

const liveSession = {
  hosting: true,
  readOnly: false,
  revoked: false,
  participants: [
    {
      participantId: "guest:tom_12345",
      name: "Tom",
      isHost: false,
      online: true,
      gradeCount: 1,
      hasBallot: true,
    },
  ],
};

const project = (title: string) => ({
  title,
  options: [
    {
      id: `${title}_opt`,
      title: "Option",
      description: "",
      status: "active" as const,
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
  ],
  contributions: [],
  sourceRefs: [],
});

describe("Agent API hardening (agentic API 1.3.0)", () => {
  let auditLog: AuditLog;
  let grantManager: GrantManager;
  let stateStore: AgentStateStore;
  let app: ReturnType<typeof createNodeApp>["app"];

  beforeEach(() => {
    auditLog = new AuditLog();
    grantManager = new GrantManager(auditLog);
    stateStore = new AgentStateStore();
    app = createNodeApp({ grantManager, stateStore, auditLog, ownerToken: OWNER_TOKEN }).app;
    stateStore.setProject("proj_1", project("proj_1"));
    stateStore.setProject("proj_2", project("proj_2"));
  });

  const grant = (
    permissions: Permission[],
    projectId = "proj_1",
    target: Target = { kind: "project" }
  ) => grantManager.createGrant({ projectId, instruction: "Help", target, permissions });

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

  describe("owner bridge", () => {
    const session = JSON.stringify(liveSession);

    it("accepts only the owner token: agents get 403, anyone else 401", async () => {
      const { token } = grant(["read", "contribute", "moderate_session"]);
      for (const [method, path, body] of [
        ["PUT", "/live-session?projectId=proj_1", session],
        ["GET", "/live-session/proposals?projectId=proj_1", undefined],
        ["POST", "/live-session/proposals/x/decision?projectId=proj_1", '{"decision":"accepted"}'],
      ] as const) {
        const asAgent = await call(path, token, { method, body });
        expect(asAgent.status).toBe(403);
        expect((await asAgent.json()).error).toBe("NOT_PERMITTED_FOR_AGENTS");
        expect((await call(path, "nope", { method, body })).status).toBe(401);
      }
      expect(stateStore.getLiveSession("proj_1")).toBeUndefined();
      expect(auditLog.getEvents().some((e) => e.details.reason === "owner_only")).toBe(true);
    });

    it("stores the owner's session for the named project and validates it", async () => {
      const ok = await call("/live-session?projectId=proj_2", OWNER_TOKEN, {
        method: "PUT",
        body: session,
      });
      expect(ok.status).toBe(200);
      expect(stateStore.getLiveSession("proj_2")?.participants).toHaveLength(1);
      expect(stateStore.getLiveSession("proj_1")).toBeUndefined();

      expect(
        (await call("/live-session", OWNER_TOKEN, { method: "PUT", body: session })).status
      ).toBe(400);
      for (const bad of ['{"hosting":"yes"}', "[1,2]", "{not json", '{"hosting":true}']) {
        const res = await call("/live-session?projectId=proj_2", OWNER_TOKEN, {
          method: "PUT",
          body: bad,
        });
        expect(res.status).toBe(400);
      }

      // A malformed push never breaks reads.
      const { token } = grant(["read"], "proj_2");
      expect((await call("/live-session", token)).status).toBe(200);

      // null ends the session.
      await call("/live-session?projectId=proj_2", OWNER_TOKEN, { method: "PUT", body: "null" });
      expect(stateStore.getLiveSession("proj_2")).toBeUndefined();
    });

    it("decides a proposal only within its own project", async () => {
      stateStore.setLiveSession("proj_1", liveSession);
      const { token } = grant(["read", "moderate_session"]);
      const created = await call("/live-session/proposals", token, {
        method: "POST",
        body: JSON.stringify({ action: "set_read_only", reason: "Done" }),
      });
      const { id } = await created.json();

      const decide = (projectId: string) =>
        call(`/live-session/proposals/${id}/decision?projectId=${projectId}`, OWNER_TOKEN, {
          method: "POST",
          body: JSON.stringify({ decision: "dismissed" }),
        });
      expect((await decide("proj_2")).status).toBe(404);
      expect(stateStore.getPendingProposals("proj_1")).toHaveLength(1);
      const other = await call("/live-session/proposals?projectId=proj_2", OWNER_TOKEN);
      expect(await other.json()).toEqual({ proposals: [] });

      expect((await decide("proj_1")).status).toBe(200);
      expect(stateStore.getAllProposals("proj_1")[0]?.status).toBe("dismissed");
    });

    it("rejects a configured owner token that is too short", () => {
      expect(() => new OwnerAuth("short")).toThrow(/at least 32/);
      expect(new OwnerAuth().token).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("get_live_session", () => {
    beforeEach(() => stateStore.setLiveSession("proj_1", liveSession));

    it("refuses grants without read, and option-scoped grants (REST)", async () => {
      const none = grant([]);
      expect((await call("/live-session", none.token)).status).toBe(403);
      const optionScoped = grant(["read", "contribute"], "proj_1", {
        kind: "option",
        optionId: "proj_1_opt",
      });
      const res = await call("/live-session", optionScoped.token);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain("Tom");
    });

    it("refuses the same grants over MCP", async () => {
      const { token } = grant([], "proj_1");
      const server = createMcpServer({ grantManager, stateStore, defaultToken: token });
      const client = new Client({ name: "t", version: "1.0.0" });
      const [c, s] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(s), client.connect(c)]);
      const res = await client.callTool({ name: "get_live_session", arguments: {} });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("403");
      await client.close();
    });
  });

  describe("propose_moderation participants", () => {
    beforeEach(() => stateStore.setLiveSession("proj_1", liveSession));

    it("rejects unknown pseudonyms and raw participant ids", async () => {
      const { token } = grant(["read", "moderate_session"]);
      for (const participant of ["p_deadbeef", "guest:tom_12345"]) {
        const res = await call("/live-session/proposals", token, {
          method: "POST",
          body: JSON.stringify({ action: "drop_votes", participant, reason: "Spam" }),
        });
        expect(res.status).toBe(400);
      }
      expect(stateStore.getAllProposals("proj_1")).toHaveLength(0);
    });

    it("does not accept another grant's pseudonym", async () => {
      const other = grant(["read", "moderate_session"]);
      const pseudo = stateStore.getPseudonym(other.grant.id, "guest:tom_12345");
      const { token } = grant(["read", "moderate_session"]);
      const res = await call("/live-session/proposals", token, {
        method: "POST",
        body: JSON.stringify({ action: "drop_votes", participant: pseudo, reason: "Spam" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects unknown pseudonyms over MCP", async () => {
      const { token } = grant(["read", "moderate_session"]);
      const server = createMcpServer({ grantManager, stateStore, defaultToken: token });
      const client = new Client({ name: "t", version: "1.0.0" });
      const [c, s] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(s), client.connect(c)]);
      const res = await client.callTool({
        name: "propose_moderation",
        arguments: { action: "drop_votes", participant: "guest:tom_12345", reason: "Spam" },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("Unknown participant");
      await client.close();
    });
  });

  describe("contributions", () => {
    it("are stored in the grant's project, whatever the target (two projects)", async () => {
      const { token } = grant(["read", "contribute"], "proj_2");
      for (const target of [undefined, { kind: "option", optionId: "proj_2_opt" }]) {
        const res = await call("/contributions", token, {
          method: "POST",
          body: JSON.stringify({ target, type: "note", body: "Looks good" }),
        });
        expect(res.status).toBe(201);
      }
      expect(stateStore.getProject("proj_2")?.contributions).toHaveLength(2);
      expect(stateStore.getProject("proj_1")?.contributions).toHaveLength(0);
    });

    it("are stored in the grant's project over MCP", async () => {
      const { token } = grant(["read", "contribute"], "proj_2");
      const server = createMcpServer({ grantManager, stateStore, defaultToken: token });
      const client = new Client({ name: "t", version: "1.0.0" });
      const [c, s] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(s), client.connect(c)]);
      const res = await client.callTool({
        name: "add_contribution",
        arguments: { type: "note", body: "Via MCP" },
      });
      expect(res.isError).toBeFalsy();
      expect(stateStore.getProject("proj_2")?.contributions).toHaveLength(1);
      expect(stateStore.getProject("proj_1")?.contributions).toHaveLength(0);
      await client.close();
    });

    it("count the 64 KB body limit in UTF-8 bytes", async () => {
      const { token } = grant(["read", "contribute"]);
      // 30 000 characters, 90 000 bytes.
      const res = await call("/contributions", token, {
        method: "POST",
        body: JSON.stringify({ type: "note", body: "€".repeat(30_000) }),
      });
      expect(res.status).toBe(413);
      expect((await res.json()).error).toBe("TOO_LARGE");
    });

    it("cap the length of each pro and con", async () => {
      const { token } = grant(["read", "contribute"]);
      const res = await call("/contributions", token, {
        method: "POST",
        body: JSON.stringify({ type: "pros_cons", body: "x", pros: ["a".repeat(2001)] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("request bodies", () => {
    it("refuses bodies over the request limit with 413", async () => {
      const { token } = grant(["read", "contribute"]);
      const res = await call("/contributions", token, {
        method: "POST",
        body: JSON.stringify({ type: "note", body: "x", pros: ["a".repeat(1024 * 1024)] }),
      });
      expect(res.status).toBe(413);
    });

    it("complete_request accepts only an object with a bounded summary", async () => {
      const { token, grant: g } = grant(["read"]);
      for (const body of ["[1]", '"done"', "42", JSON.stringify({ summary: "s".repeat(4001) })]) {
        expect((await call("/complete", token, { method: "POST", body })).status).toBe(400);
      }
      expect(grantManager.getGrant(g.id)?.status).toBe("open");
      const ok = await call("/complete", token, { method: "POST" });
      expect(ok.status).toBe(200);
    });
  });

  describe("X-Agent-Name", () => {
    it("never renames a revoked grant", async () => {
      const { token, grant: g } = grant(["read"]);
      grantManager.setAgentName(g.id, "Original");
      grantManager.revokeGrant(g.id);
      const res = await call("/request", token, { headers: { "X-Agent-Name": "Hijacked" } });
      expect(res.status).toBe(401);
      expect(grantManager.getGrant(g.id)?.agentName).toBe("Original");
    });

    it("never renames a grant whose call is refused", async () => {
      const { token, grant: g } = grant(["read"]);
      const res = await call("/options", token, {
        method: "POST",
        body: JSON.stringify({ title: "X" }),
        headers: { "X-Agent-Name": "Renamed" },
      });
      expect(res.status).toBe(403);
      expect(grantManager.getGrant(g.id)?.agentName).toBeUndefined();
    });

    it("caps the name length", async () => {
      const { token, grant: g } = grant(["read"]);
      const long = await call("/request", token, { headers: { "X-Agent-Name": "a".repeat(101) } });
      expect(long.status).toBe(400);
      expect(grantManager.getGrant(g.id)?.agentName).toBeUndefined();

      const hello = await call("/session", token, {
        method: "POST",
        body: JSON.stringify({ agentName: "b".repeat(101) }),
      });
      expect(hello.status).toBe(400);

      const ok = await call("/request", token, { headers: { "X-Agent-Name": "Bot" } });
      expect(ok.status).toBe(200);
      expect(grantManager.getGrant(g.id)?.agentName).toBe("Bot");
    });
  });
});
