import { z } from "zod";
import { TargetRefSchema } from "./contribution.js";

export const AgentPermissionSchema = z.enum(["read", "contribute", "propose_options"]);
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;

export const AgentRequestStatusSchema = z.enum(["open", "completed", "revoked", "expired"]);
export type AgentRequestStatus = z.infer<typeof AgentRequestStatusSchema>;

export const AgentRequestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  instruction: z.string().min(1),
  target: TargetRefSchema,
  permissions: z.array(AgentPermissionSchema),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  status: AgentRequestStatusSchema.default("open"),
  summary: z.string().optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const GrantLimitsSchema = z.object({
  contributionBodyMaxBytes: z.number().int().default(65536),
  maxSourcesPerContribution: z.number().int().default(20),
  maxContributionsPerRequest: z.number().int().default(50),
  callsPerMinute: z.number().int().default(60),
  defaultLifetimeHours: z.number().int().default(24),
  maxLifetimeDays: z.number().int().default(30),
});
export type GrantLimits = z.infer<typeof GrantLimitsSchema>;

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  type: z.enum([
    "agent_refused_scope",
    "agent_refused_permission",
    "agent_refused_limit",
    "agent_grant_revoked",
    "agent_request_completed",
  ]),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
