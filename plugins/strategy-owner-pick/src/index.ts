import type { Rng, StrategyInput, StrategyPlugin, StrategyResult } from "@decisionator/plugin-sdk";

export const STRATEGY_OWNER_PICK_ID = "org.decisionator.strategy.owner-pick";

export interface OwnerPickDecideResult extends StrategyResult {
  order: { optionId: string }[];
}

export const ownerPickStrategy: StrategyPlugin = {
  check(input: StrategyInput) {
    if (!input.options || input.options.length < 1) {
      return { ok: false, reason: "Owner pick requires at least 1 active option." };
    }
    const chosenId = input.runInput;
    if (typeof chosenId !== "string" || !chosenId) {
      return { ok: false, reason: "Please select an option to pick." };
    }
    const exists = input.options.some((o) => o.id === chosenId);
    if (!exists) {
      return { ok: false, reason: `Selected option "${chosenId}" is not among active options.` };
    }
    return { ok: true };
  },

  decide(input: StrategyInput, _rng: Rng): OwnerPickDecideResult {
    const chosenId = input.runInput as string;
    const chosenOption = input.options.find((o) => o.id === chosenId);

    if (!chosenOption) {
      throw new Error(`Chosen option "${chosenId}" not found in active options`);
    }

    const order = [
      { optionId: chosenOption.id },
      ...input.options.filter((o) => o.id !== chosenId).map((o) => ({ optionId: o.id })),
    ];

    return {
      chosen: [chosenOption.id],
      order,
      explanation: `Owner selected "${chosenOption.title}".`,
    };
  },
};
