import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

export interface McpServerOptions {
  grantManager: GrantManager;
  stateStore: AgentStateStore;
  defaultToken?: string;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const { grantManager, stateStore } = options;
  const server = new McpServer({
    name: "decisionator-agent-mcp",
    version: "1.0.0",
  });

  const getToken = (extra: unknown): string => {
    if (options.defaultToken) return options.defaultToken;
    const ex = extra as { authInfo?: { token?: string }; _meta?: { token?: string } } | undefined;
    return ex?.authInfo?.token || ex?._meta?.token || "";
  };

  // 1. agent_hello
  server.tool(
    "agent_hello",
    "Declares the agent name and returns request instruction, target, permissions, limits, and rules.",
    AgentHelloInputSchema.shape,
    async (args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, null);
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      if (args.agentName) {
        grantManager.setAgentName(auth.grant.id, args.agentName);
      }

      const result = {
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
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  // 2. get_request
  server.tool(
    "get_request",
    "Gets the agent request details: instruction, target, permissions, status, and expiry.",
    {},
    async (_args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, null);
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      const result = {
        id: auth.grant.id,
        projectId: auth.grant.projectId,
        instruction: auth.grant.instruction,
        target: auth.grant.target,
        permissions: auth.grant.permissions,
        createdAt: auth.grant.createdAt,
        expiresAt: auth.grant.expiresAt,
        status: auth.grant.status,
        summary: auth.grant.summary,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  // 3. get_context
  server.tool(
    "get_context",
    "Gets project context including title, description, options in scope, and accepted contributions.",
    {},
    async (_args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, "read");
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      const project = stateStore.getProject(auth.grant.projectId);
      const allOptions = stateStore.getOptions(auth.grant.projectId);

      // Filter options by scope if scope is a specific option
      const filteredOptions =
        auth.grant.target.kind === "option"
          ? allOptions.filter((o) => o.id === (auth.grant?.target as { optionId: string }).optionId)
          : allOptions;

      const accepted = stateStore.getAcceptedContributions(auth.grant.projectId);

      const result = {
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
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  // 4. list_contributions
  server.tool(
    "list_contributions",
    "Lists this request's own contributions and their review status.",
    {},
    async (_args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, "read");
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      const own = stateStore.getOwnContributions(auth.grant.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ contributions: own }) }],
      };
    }
  );

  // 5. add_contribution
  server.tool(
    "add_contribution",
    "Adds a new contribution (note, research, pros/cons, link) pending human review.",
    AddContributionInputSchema.shape,
    async (args, extra) => {
      const token = getToken(extra);
      const target = args.target;

      const auth = grantManager.verifyAccess(token, "contribute", target);
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      // Check limits
      if (args.body.length > 65536) {
        return {
          isError: true,
          content: [
            { type: "text", text: "[413] TOO_LARGE: Contribution body exceeds 64 KB limit" },
          ],
        };
      }
      if (args.sources && args.sources.length > 20) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "[400] INVALID_PARAMS: Maximum 20 sources allowed per contribution",
            },
          ],
        };
      }
      if (auth.grant.contributionsCount >= 50) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "[409] LIMIT_REACHED: Maximum 50 contributions reached for this request",
            },
          ],
        };
      }

      const effectiveTarget = target || auth.grant.target;
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
        type: args.type,
        body: args.body,
        pros: args.pros,
        cons: args.cons,
        sources: args.sources,
        author: {
          kind: "agent",
          agentName: auth.grant.agentName || "Agent",
          onBehalfOf: auth.grant.id,
        },
        reviewStatus: "pending",
      });

      grantManager.incrementContributionCount(auth.grant.id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: newContrib.id, reviewStatus: "pending" }),
          },
        ],
      };
    }
  );

  // 6. update_contribution
  server.tool(
    "update_contribution",
    "Updates an existing pending contribution created by this request.",
    UpdateContributionInputSchema.shape,
    async (args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, "contribute");
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      if (args.body && args.body.length > 65536) {
        return {
          isError: true,
          content: [
            { type: "text", text: "[413] TOO_LARGE: Contribution body exceeds 64 KB limit" },
          ],
        };
      }
      if (args.sources && args.sources.length > 20) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "[400] INVALID_PARAMS: Maximum 20 sources allowed per contribution",
            },
          ],
        };
      }

      const own = stateStore.getOwnContributions(auth.grant.id);
      const existing = own.find((c) => c.id === args.id);
      if (!existing) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "[404] NOT_FOUND: Contribution not found or not owned by this request",
            },
          ],
        };
      }
      if (existing.reviewStatus !== "pending") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "[400] INVALID_STATE: Only pending contributions may be updated",
            },
          ],
        };
      }

      const updated = stateStore.updateContribution(args.id, {
        body: args.body,
        pros: args.pros,
        cons: args.cons,
        sources: args.sources,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: updated?.id || args.id,
              reviewStatus: "pending",
              updatedAt: new Date().toISOString(),
            }),
          },
        ],
      };
    }
  );

  // 7. propose_option
  server.tool(
    "propose_option",
    "Proposes a new option for consideration when granted propose_options on a project.",
    ProposeOptionInputSchema.shape,
    async (args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, "propose_options");
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      if (auth.grant.target.kind !== "project") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "[403] NOT_PERMITTED_FOR_AGENTS: Options may only be proposed for a project-scoped request",
            },
          ],
        };
      }

      const newOption = stateStore.proposeOption(auth.grant.projectId, {
        title: args.title,
        description: args.description,
        sources: args.sources,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: newOption.id, title: newOption.title, status: "proposed" }),
          },
        ],
      };
    }
  );

  // 8. complete_request
  server.tool(
    "complete_request",
    "Marks the agent request as completed; prevents further writes.",
    CompleteRequestInputSchema.shape,
    async (args, extra) => {
      const token = getToken(extra);
      const auth = grantManager.verifyAccess(token, null);
      if (!auth.valid || !auth.grant) {
        return {
          isError: true,
          content: [{ type: "text", text: `[${auth.status}] ${auth.code}: ${auth.message}` }],
        };
      }

      grantManager.completeRequest(auth.grant.id, args.summary);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "completed", summary: args.summary }),
          },
        ],
      };
    }
  );

  return server;
}
