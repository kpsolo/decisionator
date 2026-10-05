import type { Rng, StrategyInput, StrategyPlugin, StrategyResult } from "@decisionator/plugin-sdk";

export const STRATEGY_WEIGHTED_ID = "org.decisionator.strategy.weighted";

export interface WeightedSettings {
  includeUngraded?: boolean; // default false
}

export interface WeightedOrderItem {
  optionId: string;
  weight: number;
}

export interface WeightedDecideResult extends StrategyResult {
  order: WeightedOrderItem[];
  seedUsed: string;
}

export const weightedStrategy: StrategyPlugin = {
  check(input: StrategyInput) {
    if (!input.options || input.options.length < 2) {
      return { ok: false, reason: "Weighted strategy requires at least 2 options." };
    }

    const settings = (input.settings as WeightedSettings) || {};
    const includeUngraded = settings.includeUngraded ?? false;
    const grades = input.grades || [];

    const gradeMap = new Map<string, number>();
    for (const g of grades) {
      gradeMap.set(g.optionId, g.average);
    }

    let eligibleCount = 0;
    for (const opt of input.options) {
      const avg = gradeMap.get(opt.id);
      if (avg !== undefined && avg > 0) {
        eligibleCount++;
      } else if (includeUngraded) {
        eligibleCount++;
      }
    }

    if (eligibleCount < 1) {
      return {
        ok: false,
        reason:
          "No graded options found. Please grade candidate options first, or enable 'include ungraded'.",
      };
    }

    return { ok: true };
  },

  decide(input: StrategyInput, rng: Rng): WeightedDecideResult {
    const settings = (input.settings as WeightedSettings) || {};
    const includeUngraded = settings.includeUngraded ?? false;
    const grades = input.grades || [];

    const gradeMap = new Map<string, number>();
    for (const g of grades) {
      gradeMap.set(g.optionId, g.average);
    }

    // Determine weight for each option
    // weight = average grade; if ungraded: excluded (weight 0) unless includeUngraded is true (weight 1)
    interface CandidateWithWeight {
      id: string;
      title: string;
      weight: number;
    }

    const eligible: CandidateWithWeight[] = [];
    const excluded: CandidateWithWeight[] = [];

    for (const opt of input.options) {
      const avg = gradeMap.get(opt.id);
      if (avg !== undefined && avg > 0) {
        eligible.push({ id: opt.id, title: opt.title, weight: avg });
      } else if (includeUngraded) {
        eligible.push({ id: opt.id, title: opt.title, weight: 1.0 });
      } else {
        excluded.push({ id: opt.id, title: opt.title, weight: 0 });
      }
    }

    if (eligible.length === 0) {
      throw new Error("No eligible options with positive weight for draw");
    }

    // Weighted selection without replacement using Efraimidis and Spirakis A-Res / random keys:
    // Key = rng.float() ^ (1 / weight)
    // Larger key wins!
    const scoredEligible = eligible.map((item) => {
      const r = rng.float();
      // Ensure r is strictly in (0, 1] to avoid Math.log(0) = -Infinity
      const safeR = Math.max(1e-15, Math.min(1.0, r));
      const key = safeR ** (1 / item.weight);
      return {
        ...item,
        key,
      };
    });

    // Sort descending by random key
    scoredEligible.sort((a, b) => b.key - a.key);

    const winner = scoredEligible[0];
    if (!winner) {
      throw new Error("No winning candidate option available");
    }
    const chosen = [winner.id];

    // Build complete order: drawn eligible options first, then excluded options
    const order: WeightedOrderItem[] = [
      ...scoredEligible.map((item) => ({ optionId: item.id, weight: item.weight })),
      ...excluded.map((item) => ({ optionId: item.id, weight: item.weight })),
    ];

    return {
      chosen,
      order,
      explanation: `Weighted draw chose "${winner.title}" (weight ${winner.weight.toFixed(1)}).`,
      seedUsed: rng.seed,
    };
  },
};
