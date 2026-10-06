import { z } from "zod";

export const GradeSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  by: z.string().min(1),
  /** Display name of a delegated author (live-session guest); absent for signed-in authors. */
  byName: z.string().min(1).max(80).optional(),
  optionId: z.string().min(1),
  value: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});
export type Grade = z.infer<typeof GradeSchema>;

export const CommentSchema = z
  .object({
    id: z.string().min(1),
    at: z.string().min(1),
    by: z.string().min(1),
    byName: z.string().min(1).max(80).optional(),
    optionId: z.string().min(1),
    body: z.string().max(10000),
    replaces: z.string().min(1).optional(),
    hidden: z.boolean().optional(),
  })
  .refine((c) => c.body.length > 0 || c.hidden !== undefined, {
    // Empty only for hide/unhide markers and hidden comments as shown to non-owners.
    message: "A comment needs a body unless it is a hide/unhide marker",
    path: ["body"],
  });
export type Comment = z.infer<typeof CommentSchema>;

export const createRankingSchema = (topN = 10) =>
  z.object({
    id: z.string().min(1),
    at: z.string().min(1),
    by: z.string().min(1),
    byName: z.string().min(1).max(80).optional(),
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
