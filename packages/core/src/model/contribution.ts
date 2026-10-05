import { z } from "zod";

export const SourceRefSchema = z.object({
  title: z.string().optional(),
  url: z.string().regex(/^https?:\/\//, "URL must start with http:// or https://"),
  accessedAt: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ContributionTypeSchema = z.enum(["note", "research", "pros_cons", "link"]);
export type ContributionType = z.infer<typeof ContributionTypeSchema>;

export const ContributionAuthorSchema = z.object({
  kind: z.enum(["human", "agent"]),
  agentName: z.string().optional(),
  onBehalfOf: z.string().optional(),
});
export type ContributionAuthor = z.infer<typeof ContributionAuthorSchema>;

export const ReviewStatusSchema = z.enum(["pending", "accepted", "edited", "dismissed"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const TargetRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
  }),
  z.object({
    kind: z.literal("option"),
    optionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("idea"),
    ideaId: z.string().min(1),
  }),
]);
export type TargetRef = z.infer<typeof TargetRefSchema>;

export const ContributionSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  by: z.string().min(1),
  targetKind: z.enum(["project", "option", "idea"]),
  targetId: z.string().default(""),
  type: ContributionTypeSchema,
  body: z.string().max(65536),
  pros: z.array(z.string()).max(50).optional(),
  cons: z.array(z.string()).max(50).optional(),
  sources: z.array(SourceRefSchema).max(20).optional(),
  author: ContributionAuthorSchema,
  reviewStatus: ReviewStatusSchema.default("pending"),
});
export type Contribution = z.infer<typeof ContributionSchema>;
