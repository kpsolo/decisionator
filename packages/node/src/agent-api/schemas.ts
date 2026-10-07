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

export const AgentHelloInputSchema = z.object({
  agentName: z.string().optional(),
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
  body: z.string().max(65536),
  pros: z.array(z.string()).max(50).optional(),
  cons: z.array(z.string()).max(50).optional(),
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
  body: z.string().max(65536).optional(),
  pros: z.array(z.string()).max(50).optional(),
  cons: z.array(z.string()).max(50).optional(),
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
  summary: z.string().optional(),
});
export type CompleteRequestInput = z.infer<typeof CompleteRequestInputSchema>;

export const CompleteRequestOutputSchema = z.object({
  status: z.literal("completed"),
  summary: z.string().optional(),
});
export type CompleteRequestOutput = z.infer<typeof CompleteRequestOutputSchema>;

export const AGENT_RULES_TEXT =
  "Everything the agent adds is reviewed by a human; cite sources; call complete_request when done; the agent cannot decide on the user's behalf or cast ballots.";
