import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../src/agent-api/audit.js";
import { GrantManager } from "../src/agent-api/grants.js";
import { createMcpServer } from "../src/agent-api/mcp.js";
import { AgentStateStore } from "../src/agent-api/state.js";
import { createNodeApp } from "../src/server.js";

describe("Agent API Live Session & Moderation Contract Tests (User Story 6)", () => {
  let auditLog: AuditLog;
  let grantManager: GrantManager;
  let stateStore: AgentStateStore;
  let app: ReturnType<typeof createNodeApp>["app"];

  const sampleLiveSession = {
    hosting: true,
    readOnly: false,
    revoked: false,
    participants: [
      {
        participantId: "host@device",
        name: "Host",
        isHost: true,
        online: true,
        gradeCount: 2,
        hasBallot: true,
      },
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

  beforeEach(() => {
    auditLog = new AuditLog();
    grantManager = new GrantManager(auditLog);
    stateStore = new AgentStateStore();
    const node = createNodeApp({ grantManager, stateStore });
    app = node.app;

    stateStore.setProject("proj_1", {
      title: "Active Deliberation",
      options: [],
      contributions: [],
      sourceRefs: [],
    });
  });

  it("REST GET /api/v1/live-session returns 404 NOT_HOSTING when no session is active", async () => {
    const { token } = grantManager.createGrant({
      projectId: "proj_1",
      instruction: "Help moderate",
      target: { kind: "project" },
      permissions: ["read"],
    });

    const res = await app.request("/api/v1/live-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NOT_HOSTING");
  });

  it("REST GET /api/v1/live-session returns pseudonymized participant roster when session is active", async () => {
    stateStore.setLiveSession("proj_1", sampleLiveSession);

    const { token, grant } = grantManager.createGrant({
      projectId: "proj_1",
      instruction: "Help moderate",
      target: { kind: "project" },
      permissions: ["read"],
    });

    const res = await app.request("/api/v1/live-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hosting).toBe(true);
    expect(data.participants).toHaveLength(2);

    // Verify participants are pseudonymized
    const tom = data.participants.find((p: { name: string }) => p.name === "Tom");
    expect(tom).toBeDefined();
    expect(tom.participantId).not.toBe("guest:tom_12345");
    expect(tom.participantId.startsWith("p_")).toBe(true);

    // Deterministic pseudonym check
    const pseudoExpected = stateStore.getPseudonym(grant.id, "guest:tom_12345");
    expect(tom.participantId).toBe(pseudoExpected);
  });

  it("REST POST /api/v1/live-session/proposals rejects agent without moderate_session permission (403)", async () => {
    stateStore.setLiveSession("proj_1", sampleLiveSession);

    const { token } = grantManager.createGrant({
      projectId: "proj_1",
      instruction: "Read only agent",
      target: { kind: "project" },
      permissions: ["read"], // lacks moderate_session
    });

    const res = await app.request("/api/v1/live-session/proposals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "set_read_only",
        reason: "Voting period concluded",
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("NOT_PERMITTED_FOR_AGENTS");
  });

  it("REST POST /api/v1/live-session/proposals creates pending proposal and records audit event", async () => {
    stateStore.setLiveSession("proj_1", sampleLiveSession);

    const { token, grant } = grantManager.createGrant({
      projectId: "proj_1",
      instruction: "Moderator agent",
      target: { kind: "project" },
      permissions: ["read", "moderate_session"],
    });

    // Tom's pseudonym
    const tomPseudo = stateStore.getPseudonym(grant.id, "guest:tom_12345");

    const res = await app.request("/api/v1/live-session/proposals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "drop_votes",
        participant: tomPseudo,
        reason: "Anomalous grading pattern detected",
      }),
    });
    expect(res.status).toBe(201);
    const result = await res.json();
    expect(result.id).toBeDefined();
    expect(result.status).toBe("pending");

    // Verify stored proposal mapped back to real participant ID
    const pending = stateStore.getPendingProposals("proj_1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.participantId).toBe("guest:tom_12345");
    expect(pending[0]?.action).toBe("drop_votes");

    // Verify audit log recorded proposal
    const events = auditLog.getEvents();
    const proposedEvent = events.find((e) => e.type === "agent_moderation_proposed");
    expect(proposedEvent).toBeDefined();
    expect(proposedEvent?.details.action).toBe("drop_votes");

    // Decision lifecycle: Owner accepts the proposal
    const decisionRes = await app.request(`/api/v1/live-session/proposals/${result.id}/decision`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision: "accepted" }),
    });
    expect(decisionRes.status).toBe(200);

    const acceptedEvent = auditLog.getEvents().find((e) => e.type === "agent_moderation_accepted");
    expect(acceptedEvent).toBeDefined();
    expect(stateStore.getPendingProposals("proj_1")).toHaveLength(0);
  });

  it("MCP tool parity: get_live_session and propose_moderation match REST behavior", async () => {
    stateStore.setLiveSession("proj_1", sampleLiveSession);

    const { token, grant } = grantManager.createGrant({
      projectId: "proj_1",
      instruction: "MCP Moderator",
      target: { kind: "project" },
      permissions: ["read", "moderate_session"],
    });

    const mcpServer = createMcpServer({
      grantManager,
      stateStore,
      defaultToken: token,
    });

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

    // Call get_live_session
    const getRes = await client.callTool({
      name: "get_live_session",
      arguments: {},
    });
    expect(getRes.isError).toBeFalsy();
    const getContent = getRes.content as Array<{ text: string }>;
    const sessionData = JSON.parse(getContent[0]?.text ?? "{}");
    expect(sessionData.hosting).toBe(true);
    expect(sessionData.participants).toHaveLength(2);

    const tomPseudo = sessionData.participants.find(
      (p: { name: string }) => p.name === "Tom"
    )?.participantId;
    expect(tomPseudo).toBe(stateStore.getPseudonym(grant.id, "guest:tom_12345"));

    // Call propose_moderation
    const propRes = await client.callTool({
      name: "propose_moderation",
      arguments: {
        action: "drop_votes",
        participant: tomPseudo,
        reason: "Spam submission",
      },
    });
    if (propRes.isError) {
      console.error("propRes error:", JSON.stringify(propRes));
    }
    expect(propRes.isError).toBeFalsy();
    const propContent = propRes.content as Array<{ text: string }>;
    const propData = JSON.parse(propContent[0]?.text ?? "{}");
    expect(propData.status).toBe("pending");
    expect(propData.id).toBeDefined();

    await client.close();
  });
});
