import { Hono } from "hono";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { GrantManager } from "./grants.js";
import {
  AGENT_RULES_TEXT,
  AddContributionInputSchema,
  AgentHelloInputSchema,
  CompleteRequestInputSchema,
  ProposeOptionInputSchema,
  UpdateContributionInputSchema,
} from "./schemas.js";
import type { AgentStateStore } from "./state.js";

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
      version: "1.0.0",
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
