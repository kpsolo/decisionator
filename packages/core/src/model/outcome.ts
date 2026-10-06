import { z } from "zod";

export const TieBreakStrategySchema = z.enum([
  "none",
  "average-grade",
  "first-places",
  "seeded-random",
]);
export type TieBreakStrategy = z.infer<typeof TieBreakStrategySchema>;

/**
 * One entry of an outcome's final order. `points` and `firstPlaces` are only produced by ranked
 * strategies (Borda); random, weighted and owner-pick orders list option ids alone
 * (strategy contract v1.1.0 requires only `chosen` and `explanation`).
 */
export const OutcomeOrderItemSchema = z.object({
  optionId: z.string().min(1),
  points: z.number().optional(),
  firstPlaces: z.number().int().nonnegative().optional(),
});
export type OutcomeOrderItem = z.infer<typeof OutcomeOrderItemSchema>;

export const OutcomeRecordSchema = z.object({
  id: z.string().min(1).optional(),
  round: z.number().int().min(1).optional(),
  strategy: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  settings: z.unknown(),
  inputs: z.object({
    options: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        weight: z.number().optional(),
      })
    ),
    ballots: z
      .array(
        z.object({
          by: z.string().min(1),
          ranking: z.array(z.string().min(1)),
        })
      )
      .optional(),
    grades: z
      .array(
        z.object({
          optionId: z.string().min(1),
          average: z.number(),
          count: z.number().int().nonnegative(),
        })
      )
      .optional(),
  }),
  result: z.object({
    winner: z.string().min(1),
    chosen: z.array(z.string().min(1)).optional(),
    order: z.array(OutcomeOrderItemSchema),
    explanation: z.string().optional(),
  }),
  tieBreak: TieBreakStrategySchema.optional().default("none"),
  seed: z
    .string()
    .length(32)
    .regex(/^[0-9a-fA-F]{32}$/, "Seed must be 32 hex chars")
    .optional(),
  triggeredBy: z.string().min(1),
  at: z.string().min(1),
});
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;
