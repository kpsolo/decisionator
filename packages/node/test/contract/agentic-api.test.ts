import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../../src/agent-api/audit.js";
import { GrantManager } from "../../src/agent-api/grants.js";
import { createMcpServer } from "../../src/agent-api/mcp.js";
import { AgentStateStore } from "../../src/agent-api/state.js";
import { createNodeApp } from "../../src/server.js";

describe("Agentic API Contract Tests (T097)", () => {
  let auditLog: AuditLog;
  let grantManager: GrantManager;
  let stateStore: AgentStateStore;
  let app: ReturnType<typeof createNodeApp>["app"];

  const sampleProject = {
    title: "Office Relocation",
    description: "Evaluating new office spaces",
    options: [
      {
        id: "opt_downtown",
        title: "Downtown Tower",
        description: "Central location, higher cost",
        status: "active" as const,
        order: 1,
      },
      {
        id: "opt_suburbs",
        title: "Suburban Campus",
        description: "Spacious with parking",
        status: "active" as const,
        order: 2,
      },
    ],
    contributions: [
      {
        id: "c_accepted_1",
        at: "2026-10-05T10:00:00Z",
        by: "human_reviewer",
        targetKind: "option" as const,
        targetId: "opt_downtown",
        type: "note" as const,
        body: "Building has high-speed fiber installed.",
        author: { kind: "human" as const },
        reviewStatus: "accepted" as const,
      },
      {
        id: "c_pending_other",
        at: "2026-10-05T10:05:00Z",
        by: "other_agent",
        targetKind: "option" as const,
        targetId: "opt_downtown",
        type: "note" as const,
        body: "Pending note from another agent that must not leak.",
        author: { kind: "agent" as const },
        reviewStatus: "pending" as const,
      },
    ],
    sourceRefs: [{ id: "src_1", title: "Lease details", url: "https://example.com/lease" }],
  };

  beforeEach(() => {
    auditLog = new AuditLog();
    grantManager = new GrantManager(auditLog);
    stateStore = new AgentStateStore();
    stateStore.setProject("proj_1", JSON.parse(JSON.stringify(sampleProject)));

    const created = createNodeApp({ grantManager, stateStore, auditLog });
    app = created.app;
  });

  describe("REST Transport — Happy Path for All Operations", () => {
    it("executes all 8 operations successfully", async () => {
      const { token, grant } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Analyze transit options and propose ideas",
        target: { kind: "project" },
        permissions: ["read", "contribute", "propose_options"],
      });

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      // 1. POST /session (agent_hello)
      const resHello = await app.request("/api/v1/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ agentName: "TransitBot" }),
      });
      expect(resHello.status).toBe(200);
      const helloJson = (await resHello.json()) as {
        instruction: string;
        rules?: string;
        limits: { contributionBodyMaxBytes: number };
      };
      expect(helloJson.instruction).toBe(grant.instruction);
      expect(helloJson.rules).toBeDefined();
      expect(helloJson.limits.contributionBodyMaxBytes).toBe(65536);

      // 2. GET /request (get_request)
      const resReq = await app.request("/api/v1/request", { headers });
      expect(resReq.status).toBe(200);
      const reqJson = (await resReq.json()) as { id: string; status: string };
      expect(reqJson.id).toBe(grant.id);
      expect(reqJson.status).toBe("open");

      // 3. GET /context (get_context)
      const resCtx = await app.request("/api/v1/context", { headers });
      expect(resCtx.status).toBe(200);
      const ctxJson = (await resCtx.json()) as {
        project: { title: string };
        options: unknown[];
        acceptedContributions: Array<{ id: string }>;
      };
      expect(ctxJson.project.title).toBe("Office Relocation");
      expect(ctxJson.options.length).toBe(2);
      // Only accepted contributions are included; pending from other agent is excluded
      expect(ctxJson.acceptedContributions.length).toBe(1);
      expect(ctxJson.acceptedContributions[0]?.id).toBe("c_accepted_1");

      // 4. GET /contributions (list_contributions) - initially empty for this grant
      const resList1 = await app.request("/api/v1/contributions", { headers });
      expect(resList1.status).toBe(200);
      const listJson1 = (await resList1.json()) as { contributions: unknown[] };
      expect(listJson1.contributions.length).toBe(0);

      // 5. POST /contributions (add_contribution)
      const resAdd = await app.request("/api/v1/contributions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "research",
          body: "Subway station is a 3-minute walk away.",
          sources: [{ title: "Metro map", url: "https://metro.example.com" }],
        }),
      });
      expect(resAdd.status).toBe(201);
      const addJson = (await resAdd.json()) as { id: string; reviewStatus: string };
      expect(addJson.id).toBeDefined();
      expect(addJson.reviewStatus).toBe("pending");

      // Verify list_contributions now shows the created contribution
      const resList2 = await app.request("/api/v1/contributions", { headers });
      const listJson2 = (await resList2.json()) as { contributions: Array<{ id: string }> };
      expect(listJson2.contributions.length).toBe(1);
      expect(listJson2.contributions[0]?.id).toBe(addJson.id);

      // 6. PATCH /contributions/:id (update_contribution)
      const resUpdate = await app.request(`/api/v1/contributions/${addJson.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          body: "Subway station is a 2-minute walk away (verified).",
        }),
      });
      expect(resUpdate.status).toBe(200);
      const updateJson = (await resUpdate.json()) as { reviewStatus: string; updatedAt?: string };
      expect(updateJson.reviewStatus).toBe("pending");
      expect(updateJson.updatedAt).toBeDefined();

      // 7. POST /options (propose_option)
      const resProp = await app.request("/api/v1/options", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Midtown Co-working Hub",
          description: "Flexible terms with shared conference rooms",
          sources: [{ url: "https://coworking.example.com" }],
        }),
      });
      expect(resProp.status).toBe(201);
      const propJson = (await resProp.json()) as { title: string; status: string };
      expect(propJson.title).toBe("Midtown Co-working Hub");
      expect(propJson.status).toBe("proposed");

      // 8. POST /complete (complete_request)
      const resComp = await app.request("/api/v1/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({ summary: "Completed transit study and proposed Midtown." }),
      });
      expect(resComp.status).toBe(200);
      const compJson = (await resComp.json()) as { status: string };
      expect(compJson.status).toBe("completed");

      // Attempting to write after completion is rejected
      const resAfterComplete = await app.request("/api/v1/contributions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "note",
          body: "Late note",
        }),
      });
      expect(resAfterComplete.status).toBe(409);
    });
  });

  describe("MCP Transport — Happy Path for All Operations", () => {
    it("executes all 8 operations through MCP protocol client", async () => {
      const { token, grant } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "MCP agent assignment",
        target: { kind: "project" },
        permissions: ["read", "contribute", "propose_options"],
      });

      const server = createMcpServer({
        grantManager,
        stateStore,
        defaultToken: token,
      });

      const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const getText = (res: unknown): string => {
        const c = (res as { content: Array<{ text: string }> }).content;
        return c[0]?.text ?? "";
      };

      // 1. agent_hello
      const helloRes = await client.callTool({
        name: "agent_hello",
        arguments: { agentName: "McpAgent" },
      });
      expect(helloRes.isError).toBeFalsy();
      const helloData = JSON.parse(getText(helloRes));
      expect(helloData.instruction).toBe(grant.instruction);
      expect(helloData.rules).toBeDefined();

      // 2. get_request
      const reqRes = await client.callTool({ name: "get_request", arguments: {} });
      expect(reqRes.isError).toBeFalsy();
      const reqData = JSON.parse(getText(reqRes));
      expect(reqData.id).toBe(grant.id);

      // 3. get_context
      const ctxRes = await client.callTool({ name: "get_context", arguments: {} });
      expect(ctxRes.isError).toBeFalsy();
      const ctxData = JSON.parse(getText(ctxRes));
      expect(ctxData.project.title).toBe("Office Relocation");
      expect(ctxData.options.length).toBe(2);

      // 4. list_contributions
      const listRes1 = await client.callTool({ name: "list_contributions", arguments: {} });
      expect(listRes1.isError).toBeFalsy();
      const listData1 = JSON.parse(getText(listRes1));
      expect(listData1.contributions.length).toBe(0);

      // 5. add_contribution
      const addRes = await client.callTool({
        name: "add_contribution",
        arguments: {
          type: "pros_cons",
          body: "Analysis of campus parking",
          pros: ["Free parking for 200 cars"],
          cons: ["30-minute drive from airport"],
          sources: [{ url: "https://parking.example.com" }],
        },
      });
      expect(addRes.isError).toBeFalsy();
      const addData = JSON.parse(getText(addRes));
      expect(addData.id).toBeDefined();
      expect(addData.reviewStatus).toBe("pending");

      // 6. update_contribution
      const updateRes = await client.callTool({
        name: "update_contribution",
        arguments: {
          id: addData.id,
          body: "Updated analysis of campus parking and shuttles",
        },
      });
      expect(updateRes.isError).toBeFalsy();
      const updateData = JSON.parse(getText(updateRes));
      expect(updateData.reviewStatus).toBe("pending");

      // 7. propose_option
      const propRes = await client.callTool({
        name: "propose_option",
        arguments: {
          title: "Waterfront Tech Park",
          description: "New construction near marina",
        },
      });
      expect(propRes.isError).toBeFalsy();
      const propData = JSON.parse(getText(propRes));
      expect(propData.title).toBe("Waterfront Tech Park");
      expect(propData.status).toBe("proposed");

      // 8. complete_request
      const compRes = await client.callTool({
        name: "complete_request",
        arguments: { summary: "All tasks done" },
      });
      expect(compRes.isError).toBeFalsy();
      const compData = JSON.parse(getText(compRes));
      expect(compData.status).toBe("completed");

      await client.close();
      await server.close();
    });
  });

  describe("Permission Checks & Auditing (FR-044)", () => {
    it("denies ungranted permissions and appends to audit log", async () => {
      // Grant with ONLY "read" permission
      const { token, grant } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Read-only audit",
        target: { kind: "project" },
        permissions: ["read"],
      });

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      // Reading succeeds
      const getRes = await app.request("/api/v1/context", { headers });
      expect(getRes.status).toBe(200);

      // Attempting to contribute fails with 403
      const addRes = await app.request("/api/v1/contributions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "note",
          body: "Unauthorized contribution",
        }),
      });
      expect(addRes.status).toBe(403);
      const addErr = (await addRes.json()) as { error?: string };
      expect(addErr.error).toBe("NOT_PERMITTED_FOR_AGENTS");

      // Proposing option fails with 403
      const propRes = await app.request("/api/v1/options", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "New unauthorized option" }),
      });
      expect(propRes.status).toBe(403);

      // Verify audit log recorded the refusals
      const events = auditLog.getEvents();
      expect(events.length).toBe(2);
      const e0 = events[0];
      const e1 = events[1];
      expect(e0?.type).toBe("agent_refused_permission");
      expect(e0?.details.grantId).toBe(grant.id);
      expect(e0?.details.requiredPermission).toBe("contribute");
      expect(e1?.details.requiredPermission).toBe("propose_options");
    });
  });

  describe("Grant Expiry, Revocation, and Scope", () => {
    it("rejects calls on expired or revoked grants", async () => {
      // 1. Expired grant (negative lifetime)
      const { token: expiredToken } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Quick task",
        target: { kind: "project" },
        permissions: ["read"],
        lifetimeHours: 1,
      });
      // Fast-forward expiration in memory
      const grant = grantManager.resolveGrantByToken(expiredToken);
      if (!grant) throw new Error("Grant not found");
      grant.expiresAt = new Date(Date.now() - 10_000).toISOString();

      const resExpired = await app.request("/api/v1/request", {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(resExpired.status).toBe(401);
      const expJson = (await resExpired.json()) as { error?: string };
      expect(expJson.error).toBe("EXPIRED");

      // 2. Revoked grant
      const { token: revokedToken, grant: grantToRevoke } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Task to cancel",
        target: { kind: "project" },
        permissions: ["read"],
      });
      grantManager.revokeGrant(grantToRevoke.id);

      const resRevoked = await app.request("/api/v1/request", {
        headers: { Authorization: `Bearer ${revokedToken}` },
      });
      expect(resRevoked.status).toBe(401);
      const revJson = (await resRevoked.json()) as { error?: string };
      expect(revJson.error).toBe("REVOKED");

      // 3. Unknown token
      const resUnknown = await app.request("/api/v1/request", {
        headers: { Authorization: "Bearer bad_random_token" },
      });
      expect(resUnknown.status).toBe(401);
      const unkJson = (await resUnknown.json()) as { error?: string };
      expect(unkJson.error).toBe("UNAUTHORIZED");
    });

    it("rejects out-of-scope targets and logs to audit log", async () => {
      // Grant scoped exclusively to option 'opt_downtown'
      const { token, grant } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Research downtown tower only",
        target: { kind: "option", optionId: "opt_downtown" },
        permissions: ["read", "contribute"],
      });

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      // In-scope contribution to opt_downtown succeeds
      const resInScope = await app.request("/api/v1/contributions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          target: { kind: "option", optionId: "opt_downtown" },
          type: "note",
          body: "Downtown notes",
        }),
      });
      expect(resInScope.status).toBe(201);

      // Out-of-scope contribution targeting opt_suburbs is rejected
      const resOutOfScope = await app.request("/api/v1/contributions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          target: { kind: "option", optionId: "opt_suburbs" },
          type: "note",
          body: "Suburbs note outside scope",
        }),
      });
      expect(resOutOfScope.status).toBe(403);
      const errOutOfScope = (await resOutOfScope.json()) as { error?: string };
      expect(errOutOfScope.error).toBe("OUT_OF_SCOPE");

      // Audit log records the scope violation
      const events = auditLog.getEvents();
      const scopeEvent = events.find((e) => e.type === "agent_refused_scope");
      expect(scopeEvent).toBeDefined();
      expect(scopeEvent?.details.grantId).toBe(grant.id);
    });
  });

  describe("Limits Table Compliance", () => {
    it("enforces body size limit (64 KB / 413 TOO_LARGE)", async () => {
      const { token } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Body test",
        target: { kind: "project" },
        permissions: ["contribute"],
      });

      const res = await app.request("/api/v1/contributions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "note",
          body: "x".repeat(65537),
        }),
      });
      expect(res.status).toBe(413);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("TOO_LARGE");
    });

    it("enforces max sources limit (20 / 400 INVALID_PARAMS)", async () => {
      const { token } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Sources test",
        target: { kind: "project" },
        permissions: ["contribute"],
      });

      const sources = Array.from({ length: 21 }, (_, i) => ({
        url: `https://example.com/source_${i}`,
      }));

      const res = await app.request("/api/v1/contributions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "note",
          body: "Valid body",
          sources,
        }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("INVALID_PARAMS");
    });

    it("enforces max contributions per request (50 / 409 LIMIT_REACHED)", async () => {
      const { token, grant } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Contributions cap test",
        target: { kind: "project" },
        permissions: ["contribute"],
      });

      // Simulate 50 already added contributions
      grant.contributionsCount = 50;

      const res = await app.request("/api/v1/contributions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "note",
          body: "51st contribution",
        }),
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("LIMIT_REACHED");
    });

    it("enforces rate limit (60 calls/min / 429 RATE_LIMITED)", async () => {
      const { token, grant } = grantManager.createGrant({
        projectId: "proj_1",
        instruction: "Rate limit test",
        target: { kind: "project" },
        permissions: ["read"],
      });

      // Simulate 60 calls already in current window
      grant.callsInWindow = 60;
      grant.callsWindowStart = Date.now();

      const res = await app.request("/api/v1/request", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(429);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe("RATE_LIMITED");

      const event = auditLog.getEvents().find((e) => e.type === "agent_refused_limit");
      expect(event).toBeDefined();
    });
  });

  describe("MCP and OpenAPI Parity (FR-040, Principle IV)", () => {
    it("ensures MCP tool list and OpenAPI 3.1 operations have 100% 1:1 parity", async () => {
      // 1. Fetch OpenAPI specification
      const res = await app.request("/api/v1/openapi.json");
      expect(res.status).toBe(200);
      const openapi = (await res.json()) as {
        openapi: string;
        paths: Record<string, Record<string, { operationId?: string }>>;
      };

      expect(openapi.openapi).toBe("3.1.0");

      const openApiOpIds: string[] = [];
      for (const path of Object.values(openapi.paths)) {
        for (const method of Object.values(path)) {
          if (method.operationId) {
            openApiOpIds.push(method.operationId);
          }
        }
      }

      // 2. Query MCP tools via MCP Client
      const server = createMcpServer({
        grantManager,
        stateStore,
      });
      const client = new Client({ name: "parity-checker", version: "1.0.0" });
      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();

      await Promise.all([server.connect(sTrans), client.connect(cTrans)]);

      const mcpToolsRes = await client.listTools();
      const mcpToolNames = mcpToolsRes.tools.map((t) => t.name);

      await client.close();
      await server.close();

      // Check exact matching lists
      expect(openApiOpIds.sort()).toEqual(mcpToolNames.sort());

      // Specifically check all 8 defined operations exist
      const expectedOperations = [
        "agent_hello",
        "get_request",
        "get_context",
        "list_contributions",
        "add_contribution",
        "update_contribution",
        "propose_option",
        "complete_request",
      ];

      for (const op of expectedOperations) {
        expect(openApiOpIds).toContain(op);
        expect(mcpToolNames).toContain(op);
      }
    });
  });

  describe("DNS Rebinding & Host Defense (R14)", () => {
    it("rejects malicious Host headers and permits localhost", async () => {
      // Host 'evil.attacker.com'
      const evilRes = await app.request("/api/v1/openapi.json", {
        headers: { Host: "evil.attacker.com" },
      });
      expect(evilRes.status).toBe(403);
      const evilJson = (await evilRes.json()) as { error?: string };
      expect(evilJson.error).toBe("FORBIDDEN_HOST");

      // Host '127.0.0.1:4178'
      const localRes = await app.request("/api/v1/openapi.json", {
        headers: { Host: "127.0.0.1:4178" },
      });
      expect(localRes.status).toBe(200);

      // Host 'localhost:4178'
      const localhostRes = await app.request("/api/v1/openapi.json", {
        headers: { Host: "localhost:4178" },
      });
      expect(localhostRes.status).toBe(200);
    });
  });
});
