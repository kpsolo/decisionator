import { z } from "zod";

export const GradeSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  by: z.string().min(1),
  optionId: z.string().min(1),
  value: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});
export type Grade = z.infer<typeof GradeSchema>;

export const CommentSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  by: z.string().min(1),
  optionId: z.string().min(1),
  body: z.string().min(1).max(10000),
  replaces: z.string().min(1).optional(),
  hidden: z.boolean().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const createRankingSchema = (topN = 10) =>
  z.object({
    id: z.string().min(1),
    at: z.string().min(1),
    by: z.string().min(1),
    round: z.number().int().min(1),
    ranking: z
      .array(z.string().min(1))
      .min(1)
      .max(topN)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "Ranked options must be unique",
      }),
  });

export const RankingSchema = createRankingSchema(10);
export type Ranking = z.infer<typeof RankingSchema>;
