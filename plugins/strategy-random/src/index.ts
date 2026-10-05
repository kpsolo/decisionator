import type { Rng, StrategyInput, StrategyPlugin, StrategyResult } from "@decisionator/plugin-sdk";

export const STRATEGY_RANDOM_ID = "org.decisionator.strategy.random";

export interface RandomOrderItem {
  optionId: string;
}

export interface RandomDecideResult extends StrategyResult {
  order: RandomOrderItem[];
  seedUsed: string;
}

export const randomStrategy: StrategyPlugin = {
  check(input: StrategyInput) {
    if (!input.options || input.options.length < 2) {
      return { ok: false, reason: "Uniform random draw requires at least 2 options." };
    }
    return { ok: true };
  },

  decide(input: StrategyInput, rng: Rng): RandomDecideResult {
    const options = [...input.options];
    if (options.length === 0) {
      throw new Error("No options to choose from");
    }

    // Fisher-Yates shuffle using deterministic rng.int(n)
    const shuffled = [...options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tempI = shuffled[i];
      const tempJ = shuffled[j];
      if (tempI && tempJ) {
        shuffled[i] = tempJ;
        shuffled[j] = tempI;
      }
    }

    const winner = shuffled[0];
    if (!winner) {
      throw new Error("No winning candidate option available");
    }

    return {
      chosen: [winner.id],
      order: shuffled.map((o) => ({ optionId: o.id })),
      explanation: `Uniform random draw chose "${winner.title}" among ${options.length} candidates.`,
      seedUsed: rng.seed,
    };
  },
};
