import type { Rng } from "@decisionator/core";
import type {
  StrategyCheckResult,
  StrategyInput,
  StrategyPlugin,
  StrategyResult,
} from "@decisionator/plugin-sdk";

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

    return {
      chosen: [first.id],
      order: input.options.map((o) => o.id),
      explanation: `Selected the top candidate "${first.title}".`,
      audit: {
        ballotsCounted: input.ballots?.length ?? 0,
      },
    };
  }
}
