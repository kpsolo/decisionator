import {
  AgentPermissionSchema,
  AgentRequestSchema,
  ContributionSchema,
  ContributionTypeSchema,
  GrantLimitsSchema,
  OptionPropertyDefinitionSchema,
  PropertyScalarSchema,
  PropertyValueSchema,
  ReviewStatusSchema,
  SourceRefSchema,
  TargetRefSchema,
} from "@decisionator/core";
import { z } from "zod";

/** Limits on agent input (agentic API 1.3.0). Body sizes are UTF-8 bytes, not characters. */
export const CONTRIBUTION_BODY_MAX_BYTES = 65536;
export const AGENT_NAME_MAX_LENGTH = 100;
export const CONTRIBUTION_POINT_MAX_LENGTH = 2000;
export const SUMMARY_MAX_LENGTH = 4000;
export const LIVE_SESSION_MAX_PARTICIPANTS = 500;
/** Largest request body the REST and MCP endpoints read. */
export const REQUEST_BODY_MAX_BYTES = 1024 * 1024;

/** Size of a string as UTF-8, which is what the byte limits count. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A self-declared agent name (`agent_hello`, `X-Agent-Name`). */
export const AgentNameSchema = z.string().trim().min(1).max(AGENT_NAME_MAX_LENGTH);

/** One pro or con of a contribution. */
const ContributionPointSchema = z.string().max(CONTRIBUTION_POINT_MAX_LENGTH);

export const AgentHelloInputSchema = z.object({
  agentName: AgentNameSchema.optional(),
});
export type AgentHelloInput = z.infer<typeof AgentHelloInputSchema>;

export const AgentHelloOutputSchema = z.object({
  instruction: z.string(),
  target: TargetRefSchema,
  permissions: z.array(AgentPermissionSchema),
  expiresAt: z.string(),
  limits: GrantLimitsSchema,
  rules: z.string(),
});
export type AgentHelloOutput = z.infer<typeof AgentHelloOutputSchema>;

export const GetRequestOutputSchema = AgentRequestSchema;
export type GetRequestOutput = z.infer<typeof GetRequestOutputSchema>;

export const ContextOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
});

export const SourceRefItemSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
});

/** A property declaration with the enabled plugin that declares it. */
export const DeclaredOptionPropertySchema = z.intersection(
  OptionPropertyDefinitionSchema,
  z.object({ plugin: z.string() })
);

export const GetContextOutputSchema = z.object({
  project: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
  options: z.array(ContextOptionSchema),
  acceptedContributions: z.array(ContributionSchema),
  sourceRefs: z.array(SourceRefItemSchema),
  /** Declarations of the project's enabled plugins (agentic API 1.1.0). */
  optionProperties: z.array(DeclaredOptionPropertySchema),
  /** Effective shared values of the options in scope. Per-person values are never included. */
  properties: z.array(PropertyValueSchema),
});
export type GetContextOutput = z.infer<typeof GetContextOutputSchema>;

export const ListContributionsOutputSchema = z.object({
  contributions: z.array(ContributionSchema),
});
export type ListContributionsOutput = z.infer<typeof ListContributionsOutputSchema>;

export const AddContributionInputSchema = z.object({
  target: TargetRefSchema.optional(),
  type: ContributionTypeSchema,
  body: z.string().max(CONTRIBUTION_BODY_MAX_BYTES),
  pros: z.array(ContributionPointSchema).max(50).optional(),
  cons: z.array(ContributionPointSchema).max(50).optional(),
  sources: z.array(SourceRefSchema).max(20).optional(),
});
export type AddContributionInput = z.infer<typeof AddContributionInputSchema>;

export const AddContributionOutputSchema = z.object({
  id: z.string(),
  reviewStatus: ReviewStatusSchema,
});
export type AddContributionOutput = z.infer<typeof AddContributionOutputSchema>;

export const UpdateContributionInputSchema = z.object({
  id: z.string(),
  body: z.string().max(CONTRIBUTION_BODY_MAX_BYTES).optional(),
  pros: z.array(ContributionPointSchema).max(50).optional(),
  cons: z.array(ContributionPointSchema).max(50).optional(),
  sources: z.array(SourceRefSchema).max(20).optional(),
});
export type UpdateContributionInput = z.infer<typeof UpdateContributionInputSchema>;

export const UpdateContributionOutputSchema = z.object({
  id: z.string(),
  reviewStatus: ReviewStatusSchema,
  updatedAt: z.string(),
});
export type UpdateContributionOutput = z.infer<typeof UpdateContributionOutputSchema>;

export const ProposeOptionInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  sources: z.array(SourceRefSchema).max(20).optional(),
});
export type ProposeOptionInput = z.infer<typeof ProposeOptionInputSchema>;

export const ProposeOptionOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.literal("proposed"),
});
export type ProposeOptionOutput = z.infer<typeof ProposeOptionOutputSchema>;

export const GetOptionPropertiesOutputSchema = z.object({
  optionProperties: z.array(DeclaredOptionPropertySchema),
  properties: z.array(PropertyValueSchema),
});
export type GetOptionPropertiesOutput = z.infer<typeof GetOptionPropertiesOutputSchema>;

/** REST body of `PUT /options/{optionId}/properties/{plugin}/{key}`. `null` clears the value. */
export const SetOptionPropertyBodySchema = z.object({
  value: PropertyScalarSchema,
});
export type SetOptionPropertyBody = z.infer<typeof SetOptionPropertyBodySchema>;

/** MCP input of `set_option_property`. */
export const SetOptionPropertyInputSchema = z.object({
  optionId: z.string().min(1),
  plugin: z.string().min(1).max(200),
  key: z.string().min(1).max(40),
  value: PropertyScalarSchema,
});
export type SetOptionPropertyInput = z.infer<typeof SetOptionPropertyInputSchema>;

export const SetOptionPropertyOutputSchema = PropertyValueSchema;
export type SetOptionPropertyOutput = z.infer<typeof SetOptionPropertyOutputSchema>;

export const CompleteRequestInputSchema = z.object({
  summary: z.string().max(SUMMARY_MAX_LENGTH).optional(),
});
export type CompleteRequestInput = z.infer<typeof CompleteRequestInputSchema>;

export const CompleteRequestOutputSchema = z.object({
  status: z.literal("completed"),
  summary: z.string().optional(),
});
export type CompleteRequestOutput = z.infer<typeof CompleteRequestOutputSchema>;

export const LiveParticipantProfileSchema = z.object({
  participantId: z.string().min(1).max(200),
  name: z.string().max(200),
  isHost: z.boolean(),
  online: z.boolean(),
  gradeCount: z.number().int().nonnegative(),
  hasBallot: z.boolean(),
});
export type LiveParticipantProfile = z.infer<typeof LiveParticipantProfileSchema>;

export const GetLiveSessionOutputSchema = z.object({
  hosting: z.boolean(),
  readOnly: z.boolean(),
  revoked: z.boolean(),
  participants: z.array(LiveParticipantProfileSchema),
});
export type GetLiveSessionOutput = z.infer<typeof GetLiveSessionOutputSchema>;

/** Owner bridge: body of `PUT /live-session` (`null` ends the session). */
export const LiveSessionDataSchema = z
  .object({
    hosting: z.boolean(),
    readOnly: z.boolean(),
    revoked: z.boolean(),
    participants: z.array(LiveParticipantProfileSchema).max(LIVE_SESSION_MAX_PARTICIPANTS),
  })
  .nullable();

/** Owner bridge: body of `POST /live-session/proposals/{id}/decision`. */
export const ProposalDecisionBodySchema = z.object({
  decision: z.enum(["accepted", "dismissed"]),
});

export const ProposeModerationBodySchema = z.object({
  action: z.enum(["drop_votes", "set_read_only", "allow_contributions", "revoke_link"]),
  participant: z.string().max(200).optional(),
  reason: z.string().min(1).max(500),
});
export type ProposeModerationBody = z.infer<typeof ProposeModerationBodySchema>;

export const ProposeModerationInputSchema = ProposeModerationBodySchema.refine(
  (data) => data.action !== "drop_votes" || !!data.participant,
  {
    message: "participant is required when action is drop_votes",
    path: ["participant"],
  }
);
export type ProposeModerationInput = z.infer<typeof ProposeModerationInputSchema>;

export const ProposeModerationOutputSchema = z.object({
  id: z.string(),
  status: z.literal("pending"),
});
export type ProposeModerationOutput = z.infer<typeof ProposeModerationOutputSchema>;

export const AGENT_RULES_TEXT =
  "Everything the agent adds is reviewed by a human; cite sources; call complete_request when done; the agent cannot decide on the user's behalf or cast ballots.";
