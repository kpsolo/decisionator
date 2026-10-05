import { z } from "zod";

export const VotingStateSchema = z.object({
  state: z.enum(["open", "closed"]),
  round: z.number().int().min(1),
  topN: z.number().int().min(1).max(10).default(3),
  liveResults: z.boolean(),
});
export type VotingState = z.infer<typeof VotingStateSchema>;

export const KdfParamsSchema = z.object({
  alg: z.literal("pbkdf2-sha256"),
  iterations: z.number().int().min(10000),
  salt: z.string(),
  verifier: z.string().optional(),
});
export type KdfParams = z.infer<typeof KdfParamsSchema>;

export const ProjectRefSchema = z.discriminatedUnion("store", [
  z.object({
    store: z.literal("google-sheets"),
    fileId: z.string().min(1),
  }),
  z.object({
    store: z.literal("local"),
    docId: z.string().min(1),
  }),
]);
export type ProjectRef = z.infer<typeof ProjectRefSchema>;

export const ProjectSchema = z.object({
  ref: ProjectRefSchema.optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional().default(""),
  owner: z.string().min(1).optional(),
  protected: z.boolean().default(false),
  kdf: KdfParamsSchema.optional(),
  voting: VotingStateSchema.default({
    state: "closed",
    round: 1,
    topN: 3,
    liveResults: true,
  }),
  createdAt: z.string().optional(),
  formatVersion: z.literal(1).default(1),
});
export type Project = z.infer<typeof ProjectSchema>;
