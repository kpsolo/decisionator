import type { AgentPermission, PropertyValue, TargetRef } from "@decisionator/core";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type { GrantManager, GrantVerificationResult, HttpStatus } from "./grants.js";
import type { OwnerAuth } from "./owner.js";
import {
  AGENT_NAME_MAX_LENGTH,
  AGENT_RULES_TEXT,
  AddContributionInputSchema,
  AgentHelloInputSchema,
  AgentNameSchema,
  CONTRIBUTION_BODY_MAX_BYTES,
  CompleteRequestInputSchema,
  CreateGrantBodySchema,
  LiveSessionDataSchema,
  ProposalDecisionBodySchema,
  ProposeModerationInputSchema,
  ProposeOptionInputSchema,
  REQUEST_BODY_MAX_BYTES,
  SetOptionPropertyBodySchema,
  UpdateContributionInputSchema,
  utf8Bytes,
} from "./schemas.js";
import type { AgentStateStore, DeclaredOptionProperty, SetSharedPropertyInput } from "./state.js";

export type AgentPropertyWriteResult =
  | { ok: true; value: PropertyValue }
  | { ok: false; status: HttpStatus; code: string; message: string };

/**
 * Checks a grant and, only once it is accepted, applies the agent name the caller declared for
 * this call (REST `X-Agent-Name`). A refused, revoked or expired grant is never renamed.
 */
export function authorizeAgent(
  grantManager: GrantManager,
  token: string,
  permission: AgentPermission | null,
  target?: TargetRef,
  agentName?: string
): GrantVerificationResult {
  const auth = grantManager.verifyAccess(token, permission, target);
  if (!auth.valid || !auth.grant || agentName === undefined) return auth;
  const name = AgentNameSchema.safeParse(agentName);
  if (!name.success) {
    return {
      valid: false,
      status: 400,
      code: "INVALID_PARAMS",
      message: `The agent name must be 1 to ${AGENT_NAME_MAX_LENGTH} characters`,
      grant: auth.grant,
    };
  }
  grantManager.setAgentName(auth.grant.id, name.data);
  return auth;
}

/**
 * Who may read the live session: grants with `read` on the whole project. The roster names the
 * people in the session, so option- or idea-scoped grants and grants without `read` get nothing.
 */
export function authorizeLiveSessionRead(
  grantManager: GrantManager,
  token: string,
  agentName?: string
): GrantVerificationResult {
  return authorizeAgent(grantManager, token, "read", { kind: "project" }, agentName);
}

/** A contribution body over the byte limit (UTF-8, as the contract counts it). */
export function contributionBodyTooLarge(body: unknown): boolean {
  return typeof body === "string" && utf8Bytes(body) > CONTRIBUTION_BODY_MAX_BYTES;
}

export const CONTRIBUTION_TOO_LARGE_MESSAGE = `Contribution body exceeds ${CONTRIBUTION_BODY_MAX_BYTES} bytes (64 KB)`;

/** A contribution about an option or idea the grant's project does not have (1.4.0). */
export const CONTRIBUTION_TARGET_NOT_FOUND_MESSAGE =
  "Target not found: the option or idea does not exist in this project";

/**
 * Shared by REST and MCP: an agent sets a shared option property. Needs `contribute` and the
 * option inside the grant's scope; the value is attributed to the agent and audited.
 */
export function agentSetOptionProperty(
  grantManager: GrantManager,
  stateStore: AgentStateStore,
  token: string,
  input: SetSharedPropertyInput,
  agentName?: string
): AgentPropertyWriteResult {
  const auth = authorizeAgent(
    grantManager,
    token,
    "contribute",
    { kind: "option", optionId: input.optionId },
    agentName
  );
  if (!auth.valid || !auth.grant) {
    return { ok: false, status: auth.status, code: auth.code, message: auth.message };
  }
  const grant = auth.grant;
  const result = stateStore.setSharedProperty(grant.projectId, input, {
    id: `agent:${grant.id}`,
    name: grant.agentName || "Agent",
  });
  const where = {
    grantId: grant.id,
    projectId: grant.projectId,
    optionId: input.optionId,
    plugin: input.plugin,
    key: input.key,
  };
  if (!result.ok) {
    if (result.status === 403) {
      grantManager.recordAudit("agent_refused_permission", {
        ...where,
        reason: "person_property",
      });
    }
    return result;
  }
  grantManager.recordAudit("agent_property_set", { ...where, value: result.value.value });
  return result;
}

/**
 * Declarations of enabled plugins and effective shared values of the options in the grant's
 * scope (one option for an option target, otherwise all). Per-person values are never included.
 */
export function agentOptionProperties(
  stateStore: AgentStateStore,
  projectId: string,
  target: { kind: string; optionId?: string }
): { optionProperties: DeclaredOptionProperty[]; properties: PropertyValue[] } {
  const all = stateStore.getOptions(projectId).map((o) => o.id);
  const inScope = target.kind === "option" ? all.filter((id) => id === target.optionId) : all;
  return {
    optionProperties: stateStore.getOptionProperties(projectId),
    properties: stateStore.getSharedPropertyValues(projectId, inScope),
  };
}

export interface RestApiOptions {
  grantManager: GrantManager;
  stateStore: AgentStateStore;
  /**
   * The owner's credential for the host bridge (`PUT /live-session`, `GET
   * /live-session/proposals`, `POST /live-session/proposals/{id}/decision`). Without it those
   * routes refuse every caller.
   */
  ownerAuth?: OwnerAuth;
}

type RestEnv = { Variables: { token: string; agentName?: string } };

type JsonBody = { ok: true; value: unknown } | { ok: false };

/** Reads a JSON body; an empty body is `{}` when `optional`. */
async function readJsonBody(c: Context<RestEnv>, optional: boolean): Promise<JsonBody> {
  const text = await c.req.text();
  if (!text.trim()) return optional ? { ok: true, value: {} } : { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createRestRouter(options: RestApiOptions): Hono<RestEnv> {
  const { grantManager, stateStore, ownerAuth } = options;
  const router = new Hono<RestEnv>();

  const extractToken = (authHeader?: string): string => {
    if (!authHeader) return "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1] ? match[1].trim() : "";
  };

  const invalid = (c: Context<RestEnv>, message: string) =>
    c.json({ error: "INVALID_PARAMS", message }, 400);

  const refused = (c: Context<RestEnv>, auth: GrantVerificationResult) =>
    c.json({ error: auth.code, message: auth.message }, auth.status);

  /** Grant check for agent routes; applies `X-Agent-Name` only after the grant is accepted. */
  const authorize = (
    c: Context<RestEnv>,
    permission: AgentPermission | null,
    target?: TargetRef
  ): GrantVerificationResult =>
    authorizeAgent(grantManager, c.get("token"), permission, target, c.get("agentName"));

  /**
   * Owner bridge check: the owner token passes; an agent grant token is refused with 403 (agents
   * never act as the owner); anything else is 401. Returns the response to send, or null.
   */
  const ownerOnly = (c: Context<RestEnv>) => {
    const token = c.get("token");
    if (ownerAuth?.verify(token)) return null;
    const grant = token ? grantManager.resolveGrantByToken(token) : undefined;
    if (grant) {
      grantManager.recordAudit("agent_refused_permission", {
        grantId: grant.id,
        reason: "owner_only",
        path: c.req.path,
      });
      return c.json(
        {
          error: "NOT_PERMITTED_FOR_AGENTS",
          message: "Only the project owner can do this; agents may only propose",
        },
        403
      );
    }
    return c.json({ error: "UNAUTHORIZED", message: "Invalid or missing owner token" }, 401);
  };

  /** The project an owner-bridge call is about (`?projectId=`). */
  const ownerProjectId = (c: Context<RestEnv>): string | null => {
    const projectId = c.req.query("projectId")?.trim();
    return projectId ? projectId : null;
  };

  router.use(
    "*",
    bodyLimit({
      maxSize: REQUEST_BODY_MAX_BYTES,
      onError: (c) =>
        c.json(
          { error: "TOO_LARGE", message: `Request body exceeds ${REQUEST_BODY_MAX_BYTES} bytes` },
          413
        ),
    })
  );

  // Token and the optional per-call agent name; the name is applied only after authorization.
  router.use("*", async (c, next) => {
    c.set("token", extractToken(c.req.header("authorization")));
    const agentName = c.req.header("x-agent-name");
    if (agentName !== undefined) c.set("agentName", agentName);
    return next();
  });

  // 1. POST /session (agent_hello)
  router.post("/session", async (c) => {
    const auth = authorize(c, null);
    if (!auth.valid || !auth.grant) return refused(c, auth);

    const body = await readJsonBody(c, true);
    const parsed = body.ok ? AgentHelloInputSchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return invalid(
        c,
        parsed?.error.issues[0]?.message ?? "Request body must be a JSON object, if present"
      );
    }
    if (parsed.data.agentName) {
      grantManager.setAgentName(auth.grant.id, parsed.data.agentName);
    }

    return c.json({
      instruction: auth.grant.instruction,
      target: auth.grant.target,
      permissions: auth.grant.permissions,
      expiresAt: auth.grant.expiresAt,
      limits: {
        contributionBodyMaxBytes: CONTRIBUTION_BODY_MAX_BYTES,
        maxSourcesPerContribution: 20,
        maxContributionsPerRequest: 50,
        callsPerMinute: 60,
        defaultLifetimeHours: 24,
        maxLifetimeDays: 30,
      },
      rules: AGENT_RULES_TEXT,
    });
  });

  // 2. GET /request (get_request)
  router.get("/request", async (c) => {
    const auth = authorize(c, null);
    if (!auth.valid || !auth.grant) return refused(c, auth);

    return c.json({
      id: auth.grant.id,
      projectId: auth.grant.projectId,
      instruction: auth.grant.instruction,
      target: auth.grant.target,
      permissions: auth.grant.permissions,
      createdAt: auth.grant.createdAt,
      expiresAt: auth.grant.expiresAt,
      status: auth.grant.status,
      summary: auth.grant.summary,
    });
  });

  // 3. GET /context (get_context)
  router.get("/context", async (c) => {
    const auth = authorize(c, "read");
    if (!auth.valid || !auth.grant) return refused(c, auth);

    const project = stateStore.getProject(auth.grant.projectId);
    const allOptions = stateStore.getOptions(auth.grant.projectId);

    const filteredOptions =
      auth.grant.target.kind === "option"
        ? allOptions.filter((o) => o.id === (auth.grant?.target as { optionId: string }).optionId)
        : allOptions;

    const accepted = stateStore.getAcceptedContributions(auth.grant.projectId);

    return c.json({
      project: {
        title: project?.title || "Untitled Project",
        description: project?.description || "",
      },
      options: filteredOptions.map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        category: o.category,
      })),
      acceptedContributions: accepted,
      sourceRefs: project?.sourceRefs || [],
      ...agentOptionProperties(stateStore, auth.grant.projectId, auth.grant.target),
    });
  });

  // 4. GET /contributions (list_contributions)
  router.get("/contributions", async (c) => {
    const auth = authorize(c, "read");
    if (!auth.valid || !auth.grant) return refused(c, auth);

    const own = stateStore.getOwnContributions(auth.grant.id);
    return c.json({ contributions: own });
  });

  // 5. POST /contributions (add_contribution)
  router.post("/contributions", async (c) => {
    const body = await readJsonBody(c, false);
    if (!body.ok || !isObject(body.value)) {
      return invalid(c, "Request body must be an object");
    }

    if (contributionBodyTooLarge(body.value.body)) {
      return c.json({ error: "TOO_LARGE", message: CONTRIBUTION_TOO_LARGE_MESSAGE }, 413);
    }

    const parseResult = AddContributionInputSchema.safeParse(body.value);
    if (!parseResult.success) {
      return invalid(c, parseResult.error.issues[0]?.message || "Invalid input");
    }

    const data = parseResult.data;
    const auth = authorize(c, "contribute", data.target);
    if (!auth.valid || !auth.grant) return refused(c, auth);

    if (auth.grant.contributionsCount >= 50) {
      return c.json(
        { error: "LIMIT_REACHED", message: "Maximum 50 contributions reached for this request" },
        409
      );
    }

    const effectiveTarget = data.target || auth.grant.target;
    if (!stateStore.targetExists(auth.grant.projectId, effectiveTarget)) {
      return c.json({ error: "NOT_FOUND", message: CONTRIBUTION_TARGET_NOT_FOUND_MESSAGE }, 404);
    }
    const targetId =
      effectiveTarget.kind === "option"
        ? effectiveTarget.optionId
        : effectiveTarget.kind === "idea"
          ? effectiveTarget.ideaId
          : auth.grant.projectId;

    const newContrib = stateStore.addContribution(auth.grant.id, auth.grant.projectId, {
      id: `contrib_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      at: new Date().toISOString(),
      by: `agent:${auth.grant.agentName || "unnamed"}`,
      targetKind: effectiveTarget.kind,
      targetId,
      type: data.type,
      body: data.body,
      pros: data.pros,
      cons: data.cons,
      sources: data.sources,
      author: {
        kind: "agent",
        agentName: auth.grant.agentName || "Agent",
        onBehalfOf: auth.grant.id,
      },
      reviewStatus: "pending",
    });

    grantManager.incrementContributionCount(auth.grant.id);

    return c.json({ id: newContrib.id, reviewStatus: "pending" }, 201);
  });

  // 6. PATCH /contributions/:id (update_contribution)
  router.patch("/contributions/:id", async (c) => {
    const id = c.req.param("id");
    const auth = authorize(c, "contribute");
    if (!auth.valid || !auth.grant) return refused(c, auth);

    const body = await readJsonBody(c, false);
    if (!body.ok || !isObject(body.value)) {
      return invalid(c, "Request body must be an object");
    }

    if (contributionBodyTooLarge(body.value.body)) {
      return c.json({ error: "TOO_LARGE", message: CONTRIBUTION_TOO_LARGE_MESSAGE }, 413);
    }

    const parseResult = UpdateContributionInputSchema.omit({ id: true }).safeParse(body.value);
    if (!parseResult.success) {
      return invalid(c, parseResult.error.issues[0]?.message || "Invalid input");
    }

    const data = parseResult.data;
    const own = stateStore.getOwnContributions(auth.grant.id);
    const existing = own.find((con) => con.id === id);
    if (!existing) {
      return c.json({ error: "NOT_FOUND", message: "Contribution not found" }, 404);
    }
    if (existing.reviewStatus !== "pending") {
      return c.json(
        { error: "INVALID_STATE", message: "Only pending contributions can be updated" },
        400
      );
    }

    const updated = stateStore.updateContribution(id, data);
    return c.json({
      id: updated?.id || id,
      reviewStatus: "pending",
      updatedAt: new Date().toISOString(),
    });
  });

  // 7. POST /options (propose_option)
  router.post("/options", async (c) => {
    const auth = authorize(c, "propose_options");
    if (!auth.valid || !auth.grant) return refused(c, auth);

    if (auth.grant.target.kind !== "project") {
      return c.json(
        {
          error: "NOT_PERMITTED_FOR_AGENTS",
          message: "Options may only be proposed for a project-scoped request",
        },
        403
      );
    }

    const body = await readJsonBody(c, false);
    const parseResult = ProposeOptionInputSchema.safeParse(body.ok ? body.value : undefined);
    if (!parseResult.success) {
      return invalid(c, parseResult.error.issues[0]?.message || "Invalid input");
    }

    const newOption = stateStore.proposeOption(auth.grant.projectId, parseResult.data);
    return c.json({ id: newOption.id, title: newOption.title, status: "proposed" }, 201);
  });

  // 7a. GET /properties (get_option_properties)
  router.get("/properties", async (c) => {
    const auth = authorize(c, "read");
    if (!auth.valid || !auth.grant) return refused(c, auth);
    return c.json(agentOptionProperties(stateStore, auth.grant.projectId, auth.grant.target));
  });

  // 7b. PUT /options/:optionId/properties/:plugin/:key (set_option_property)
  router.put("/options/:optionId/properties/:plugin/:key", async (c) => {
    const body = await readJsonBody(c, false);
    if (!body.ok || !isObject(body.value) || !("value" in body.value)) {
      return invalid(c, "Request body must be an object with a value");
    }
    const result = agentSetOptionProperty(
      grantManager,
      stateStore,
      c.get("token"),
      {
        optionId: c.req.param("optionId"),
        plugin: c.req.param("plugin"),
        key: c.req.param("key"),
        value: body.value.value,
      },
      c.get("agentName")
    );
    if (!result.ok) {
      return c.json({ error: result.code, message: result.message }, result.status);
    }
    return c.json(result.value, 200);
  });

  // 8. POST /complete (complete_request)
  router.post("/complete", async (c) => {
    const auth = authorize(c, null);
    if (!auth.valid || !auth.grant) return refused(c, auth);

    const body = await readJsonBody(c, true);
    const parsed = body.ok ? CompleteRequestInputSchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return invalid(
        c,
        parsed?.error.issues[0]?.message ?? "Request body must be a JSON object, if present"
      );
    }
    grantManager.completeRequest(auth.grant.id, parsed.data.summary);
    return c.json({ status: "completed", summary: parsed.data.summary });
  });

  // 9. GET /live-session (get_live_session): `read` on the whole project
  router.get("/live-session", async (c) => {
    const auth = authorizeLiveSessionRead(grantManager, c.get("token"), c.get("agentName"));
    if (!auth.valid || !auth.grant) return refused(c, auth);
    const grantId = auth.grant.id;
    const session = stateStore.getLiveSession(auth.grant.projectId);
    if (!session || !session.hosting) {
      return c.json({ error: "NOT_HOSTING", message: "No live session is currently hosted" }, 404);
    }
    return c.json({
      hosting: session.hosting,
      readOnly: session.readOnly,
      revoked: session.revoked,
      participants: session.participants.map((p) => ({
        ...p,
        participantId: stateStore.getPseudonym(grantId, p.participantId),
      })),
    });
  });

  // 10. POST /live-session/proposals (propose_moderation)
  router.post("/live-session/proposals", async (c) => {
    const auth = authorize(c, "moderate_session");
    if (!auth.valid || !auth.grant) return refused(c, auth);
    const session = stateStore.getLiveSession(auth.grant.projectId);
    if (!session || !session.hosting) {
      return c.json({ error: "NOT_HOSTING", message: "No live session is currently hosted" }, 404);
    }
    const body = await readJsonBody(c, false);
    if (!body.ok || !isObject(body.value)) {
      return invalid(c, "Request body must be an object");
    }
    const parsed = ProposeModerationInputSchema.safeParse(body.value);
    if (!parsed.success) {
      return invalid(c, parsed.error.issues[0]?.message || "Invalid moderation proposal");
    }
    const proposal = stateStore.proposeModeration(
      auth.grant.projectId,
      auth.grant.id,
      auth.grant.agentName || "Agent",
      parsed.data
    );
    if (!proposal) {
      return invalid(c, "Unknown participant: use a participantId from get_live_session");
    }
    grantManager.recordAudit("agent_moderation_proposed", {
      grantId: auth.grant.id,
      proposalId: proposal.id,
      action: proposal.action,
      reason: proposal.reason,
    });
    return c.json({ id: proposal.id, status: "pending" }, 201);
  });

  // Owner bridge (the owner's hosting tab, owner token only; never agents):
  router.put("/live-session", async (c) => {
    const denied = ownerOnly(c);
    if (denied) return denied;
    const projectId = ownerProjectId(c);
    if (!projectId) return invalid(c, "projectId query parameter is required");
    const body = await readJsonBody(c, false);
    const parsed = body.ok ? LiveSessionDataSchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return invalid(
        c,
        parsed?.error.issues[0]?.message ?? "Request body must be a live session summary or null"
      );
    }
    stateStore.setLiveSession(projectId, parsed.data);
    return c.json({ ok: true });
  });

  router.get("/live-session/proposals", async (c) => {
    const denied = ownerOnly(c);
    if (denied) return denied;
    const projectId = ownerProjectId(c);
    if (!projectId) return invalid(c, "projectId query parameter is required");
    return c.json({ proposals: stateStore.getAllProposals(projectId) });
  });

  router.post("/live-session/proposals/:id/decision", async (c) => {
    const denied = ownerOnly(c);
    if (denied) return denied;
    const projectId = ownerProjectId(c);
    if (!projectId) return invalid(c, "projectId query parameter is required");
    const body = await readJsonBody(c, false);
    const parsed = body.ok ? ProposalDecisionBodySchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return invalid(c, "Decision must be accepted or dismissed");
    }
    const updated = stateStore.decideProposal(projectId, c.req.param("id"), parsed.data.decision);
    if (!updated) {
      return c.json({ error: "NOT_FOUND", message: "Proposal not found in this project" }, 404);
    }
    grantManager.recordAudit(
      parsed.data.decision === "accepted"
        ? "agent_moderation_accepted"
        : "agent_moderation_dismissed",
      {
        grantId: updated.grantId,
        projectId,
        proposalId: updated.id,
        action: updated.action,
        decidedBy: "owner",
      }
    );
    return c.json({ ok: true, proposal: updated });
  });

  // Owner: mint an agent grant. The token is returned once; only its hash is kept (1.4.0).
  router.post("/grants", async (c) => {
    const denied = ownerOnly(c);
    if (denied) return denied;
    const body = await readJsonBody(c, false);
    const parsed = body.ok ? CreateGrantBodySchema.safeParse(body.value) : null;
    if (!parsed?.success) {
      return invalid(c, parsed?.error.issues[0]?.message ?? "Request body must be a JSON object");
    }
    const { grant, token } = grantManager.createGrant(parsed.data);
    grantManager.recordAudit("agent_grant_created", {
      grantId: grant.id,
      projectId: grant.projectId,
      target: grant.target,
      permissions: grant.permissions,
      expiresAt: grant.expiresAt,
    });
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        id: grant.id,
        token,
        projectId: grant.projectId,
        target: grant.target,
        permissions: grant.permissions,
        expiresAt: grant.expiresAt,
      },
      201
    );
  });

  // Owner: revoke an agent grant.
  router.delete("/grants/:id", async (c) => {
    const denied = ownerOnly(c);
    if (denied) return denied;
    if (!grantManager.revokeGrant(c.req.param("id"))) {
      return c.json({ error: "NOT_FOUND", message: "Grant not found" }, 404);
    }
    return c.json({ ok: true });
  });

  // 11. GET /openapi.json (OpenAPI 3.1 schema)
  router.get("/openapi.json", (c) => {
    const openapi = generateOpenApiSpec();
    return c.json(openapi);
  });

  return router;
}

export function generateOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Decisionator Agent API",
      version: "1.4.0",
      description: "Local & remote agent API for Decisionator with full MCP parity.",
    },
    paths: {
      "/session": {
        post: {
          operationId: "agent_hello",
          summary: "Declares agent name and returns brief context and rules",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: z.toJSONSchema(AgentHelloInputSchema, { io: "input" }),
              },
            },
          },
          responses: {
            "200": { description: "Session started" },
          },
        },
      },
      "/request": {
        get: {
          operationId: "get_request",
          summary: "Gets request instruction and scope",
          responses: {
            "200": { description: "Current request details" },
          },
        },
      },
      "/context": {
        get: {
          operationId: "get_context",
          summary: "Gets project context and options",
          responses: {
            "200": { description: "Context details" },
          },
        },
      },
      "/contributions": {
        get: {
          operationId: "list_contributions",
          summary: "Lists own contributions",
          responses: {
            "200": { description: "Own contributions list" },
          },
        },
        post: {
          operationId: "add_contribution",
          summary: "Adds a contribution",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: z.toJSONSchema(AddContributionInputSchema, { io: "input" }),
              },
            },
          },
          responses: {
            "201": { description: "Contribution added" },
          },
        },
      },
      "/contributions/{id}": {
        patch: {
          operationId: "update_contribution",
          summary: "Updates a pending contribution",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: z.toJSONSchema(UpdateContributionInputSchema.omit({ id: true }), {
                  io: "input",
                }),
              },
            },
          },
          responses: {
            "200": { description: "Contribution updated" },
          },
        },
      },
      "/options": {
        post: {
          operationId: "propose_option",
          summary: "Proposes an option",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: z.toJSONSchema(ProposeOptionInputSchema, { io: "input" }),
              },
            },
          },
          responses: {
            "201": { description: "Option proposed" },
          },
        },
      },
      "/properties": {
        get: {
          operationId: "get_option_properties",
          summary:
            "Gets option property declarations of enabled plugins and shared values of options in scope",
          responses: {
            "200": { description: "Declarations and shared values" },
          },
        },
      },
      "/options/{optionId}/properties/{plugin}/{key}": {
        put: {
          operationId: "set_option_property",
          summary: "Sets a shared option property value (null clears it); attributed to the agent",
          parameters: ["optionId", "plugin", "key"].map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: z.toJSONSchema(SetOptionPropertyBodySchema, { io: "input" }),
              },
            },
          },
          responses: {
            "200": { description: "The stored property value" },
            "400": { description: "Invalid value" },
            "403": { description: "Person-scoped property, missing permission or out of scope" },
            "404": { description: "Unknown option or undeclared property" },
          },
        },
      },
      "/complete": {
        post: {
          operationId: "complete_request",
          summary: "Marks request completed",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: z.toJSONSchema(CompleteRequestInputSchema, { io: "input" }),
              },
            },
          },
          responses: {
            "200": { description: "Request completed" },
          },
        },
      },
      "/live-session": {
        get: {
          operationId: "get_live_session",
          summary: "Inspects active shared session state",
          responses: {
            "200": { description: "Live session state" },
            "404": { description: "No session currently hosted" },
          },
        },
      },
      "/live-session/proposals": {
        post: {
          operationId: "propose_moderation",
          summary: "Proposes a moderation action to session owner",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: z.toJSONSchema(ProposeModerationInputSchema, { io: "input" }),
              },
            },
          },
          responses: {
            "201": { description: "Proposal created" },
            "403": { description: "Missing moderate_session permission" },
            "404": { description: "No session currently hosted" },
          },
        },
      },
    },
  };
}
