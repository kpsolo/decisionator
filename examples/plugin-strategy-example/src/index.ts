import type { Rng } from "@decisionator/core";
import type { StrategyInput, StrategyPlugin, StrategyResult } from "@decisionator/plugin-sdk";

type StrategyCheckResult = ReturnType<StrategyPlugin["check"]>;

export class FirstCandidateStrategy implements StrategyPlugin {
  readonly id = "org.decisionator.examples.strategy.first";
  readonly version = "0.1.0";

  check(input: StrategyInput): StrategyCheckResult {
    if (!input.options || input.options.length < 2) {
      return { ok: false, reason: "Requires at least 2 options to make a decision" };
    }
    return { ok: true };
  }

  decide(input: StrategyInput, _rng: Rng): StrategyResult {
    const first = input.options[0];
    if (!first) {
      throw new Error("No options available");
    }

    const ballots = input.ballots?.length ?? 0;
    return {
      chosen: [first.id],
      explanation: `Selected the top candidate "${first.title}" (${ballots} ballot${ballots === 1 ? "" : "s"} counted).`,
    };
  }
}
