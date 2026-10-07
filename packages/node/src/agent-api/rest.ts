import type { PropertyValue } from "@decisionator/core";
import { Hono } from "hono";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { GrantManager, HttpStatus } from "./grants.js";
import {
  AGENT_RULES_TEXT,
  AddContributionInputSchema,
  AgentHelloInputSchema,
  CompleteRequestInputSchema,
  ProposeOptionInputSchema,
  SetOptionPropertyBodySchema,
  UpdateContributionInputSchema,
} from "./schemas.js";
import type { AgentStateStore, DeclaredOptionProperty, SetSharedPropertyInput } from "./state.js";

export type AgentPropertyWriteResult =
  | { ok: true; value: PropertyValue }
  | { ok: false; status: HttpStatus; code: string; message: string };

/**
 * Shared by REST and MCP: an agent sets a shared option property. Needs `contribute` and the
 * option inside the grant's scope; the value is attributed to the agent and audited.
 */
export function agentSetOptionProperty(
  grantManager: GrantManager,
  stateStore: AgentStateStore,
  token: string,
  input: SetSharedPropertyInput
): AgentPropertyWriteResult {
  const auth = grantManager.verifyAccess(token, "contribute", {
    kind: "option",
    optionId: input.optionId,
  });
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
}

export function createRestRouter(options: RestApiOptions): Hono {
  const { grantManager, stateStore } = options;
  const router = new Hono();

  const extractToken = (authHeader?: string): string => {
    if (!authHeader) return "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1] ? match[1].trim() : "";
  };

  // Middleware to extract token & handle X-Agent-Name
  router.use("*", async (c, next) => {
    // Skip auth check for openapi.json
    if (c.req.path.endsWith("/openapi.json")) {
      return next();
    }
    const token = extractToken(c.req.header("authorization"));
    c.set("token" as never, token as never);

    const agentName = c.req.header("x-agent-name");
    if (agentName && token) {
      const grant = grantManager.resolveGrantByToken(token);
      if (grant) {
        grantManager.setAgentName(grant.id, agentName);
      }
    }

    return next();
  });

  // 1. POST /session (agent_hello)
  router.post("/session", async (c) => {
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, null);
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

    const body = (await c.req.json().catch(() => ({}))) as { agentName?: string };
    if (body.agentName) {
      grantManager.setAgentName(auth.grant.id, body.agentName);
    }

    return c.json({
      instruction: auth.grant.instruction,
      target: auth.grant.target,
      permissions: auth.grant.permissions,
      expiresAt: auth.grant.expiresAt,
      limits: {
        contributionBodyMaxBytes: 65536,
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
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, null);
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

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
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, "read");
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

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
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, "read");
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

    const own = stateStore.getOwnContributions(auth.grant.id);
    return c.json({ contributions: own });
  });

  // 5. POST /contributions (add_contribution)
  router.post("/contributions", async (c) => {
    const token = c.get("token" as never) as string;
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "INVALID_PARAMS", message: "Request body must be an object" }, 400);
    }

    if (
      typeof (body as { body?: unknown }).body === "string" &&
      (body as { body: string }).body.length > 65536
    ) {
      return c.json({ error: "TOO_LARGE", message: "Contribution body exceeds 64 KB limit" }, 413);
    }

    const parseResult = AddContributionInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "INVALID_PARAMS",
          message: parseResult.error.issues[0]?.message || "Invalid input",
        },
        400
      );
    }

    const data = parseResult.data;
    const auth = grantManager.verifyAccess(token, "contribute", data.target);
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

    if (data.body.length > 65536) {
      return c.json({ error: "TOO_LARGE", message: "Contribution body exceeds 64 KB" }, 413);
    }
    if (data.sources && data.sources.length > 20) {
      return c.json({ error: "INVALID_PARAMS", message: "Maximum 20 sources allowed" }, 400);
    }
    if (auth.grant.contributionsCount >= 50) {
      return c.json(
        { error: "LIMIT_REACHED", message: "Maximum 50 contributions reached for this request" },
        409
      );
    }

    const effectiveTarget = data.target || auth.grant.target;
    const targetId =
      effectiveTarget.kind === "option"
        ? effectiveTarget.optionId
        : effectiveTarget.kind === "idea"
          ? effectiveTarget.ideaId
          : auth.grant.projectId;

    const newContrib = stateStore.addContribution(auth.grant.id, {
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
    const token = c.get("token" as never) as string;
    const id = c.req.param("id");
    const auth = grantManager.verifyAccess(token, "contribute");
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "INVALID_PARAMS", message: "Request body must be an object" }, 400);
    }

    if (
      typeof (body as { body?: unknown }).body === "string" &&
      (body as { body: string }).body.length > 65536
    ) {
      return c.json({ error: "TOO_LARGE", message: "Contribution body exceeds 64 KB" }, 413);
    }

    const parseResult = UpdateContributionInputSchema.omit({ id: true }).safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "INVALID_PARAMS",
          message: parseResult.error.issues[0]?.message || "Invalid input",
        },
        400
      );
    }

    const data = parseResult.data;
    if (data.body && data.body.length > 65536) {
      return c.json({ error: "TOO_LARGE", message: "Contribution body exceeds 64 KB" }, 413);
    }
    if (data.sources && data.sources.length > 20) {
      return c.json({ error: "INVALID_PARAMS", message: "Maximum 20 sources allowed" }, 400);
    }

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
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, "propose_options");
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

    if (auth.grant.target.kind !== "project") {
      return c.json(
        {
          error: "NOT_PERMITTED_FOR_AGENTS",
          message: "Options may only be proposed for a project-scoped request",
        },
        403
      );
    }

    const body = await c.req.json().catch(() => null);
    const parseResult = ProposeOptionInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "INVALID_PARAMS",
          message: parseResult.error.issues[0]?.message || "Invalid input",
        },
        400
      );
    }

    const newOption = stateStore.proposeOption(auth.grant.projectId, parseResult.data);
    return c.json({ id: newOption.id, title: newOption.title, status: "proposed" }, 201);
  });

  // 7a. GET /properties (get_option_properties)
  router.get("/properties", async (c) => {
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, "read");
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }
    return c.json(agentOptionProperties(stateStore, auth.grant.projectId, auth.grant.target));
  });

  // 7b. PUT /options/:optionId/properties/:plugin/:key (set_option_property)
  router.put("/options/:optionId/properties/:plugin/:key", async (c) => {
    const token = c.get("token" as never) as string;
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("value" in body)) {
      return c.json(
        { error: "INVALID_PARAMS", message: "Request body must be an object with a value" },
        400
      );
    }
    const result = agentSetOptionProperty(grantManager, stateStore, token, {
      optionId: c.req.param("optionId"),
      plugin: c.req.param("plugin"),
      key: c.req.param("key"),
      value: (body as { value: unknown }).value,
    });
    if (!result.ok) {
      return c.json({ error: result.code, message: result.message }, result.status);
    }
    return c.json(result.value, 200);
  });

  // 8. POST /complete (complete_request)
  router.post("/complete", async (c) => {
    const token = c.get("token" as never) as string;
    const auth = grantManager.verifyAccess(token, null);
    if (!auth.valid || !auth.grant) {
      return c.json({ error: auth.code, message: auth.message }, auth.status);
    }

    const body = (await c.req.json().catch(() => ({}))) as { summary?: string };
    grantManager.completeRequest(auth.grant.id, body.summary);
    return c.json({ status: "completed", summary: body.summary });
  });

  // 9. GET /openapi.json (OpenAPI 3.1 schema)
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
      version: "1.1.0",
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
                schema: zodToJsonSchema(AgentHelloInputSchema),
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
                schema: zodToJsonSchema(AddContributionInputSchema),
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
                schema: zodToJsonSchema(UpdateContributionInputSchema.omit({ id: true })),
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
                schema: zodToJsonSchema(ProposeOptionInputSchema),
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
                schema: zodToJsonSchema(SetOptionPropertyBodySchema),
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
                schema: zodToJsonSchema(CompleteRequestInputSchema),
              },
            },
          },
          responses: {
            "200": { description: "Request completed" },
          },
        },
      },
    },
  };
}
