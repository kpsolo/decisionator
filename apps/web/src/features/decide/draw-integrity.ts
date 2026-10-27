import {
  type OutcomeRecord,
  type OutcomeSeedCheck,
  latestOutcome,
  redecidedCount,
  verifyOutcomeSeed,
} from "@decisionator/core";

/** What the decide UI says about the outcome in force for a round (strategy contract v1.2.0). */
export interface DrawIntegrity {
  outcome: OutcomeRecord;
  seed: OutcomeSeedCheck;
  /** Outcomes recorded for the round after the first one. */
  redecided: number;
}

/** The latest outcome of `round` with its seed check and re-decide count; null when undecided. */
export function drawIntegrity(
  outcomes: readonly OutcomeRecord[],
  round: number
): DrawIntegrity | null {
  const inRound = outcomes.filter((o) => (o.round ?? 1) === round);
  const outcome = latestOutcome(inRound);
  if (!outcome) return null;
  return {
    outcome,
    seed: verifyOutcomeSeed(outcome),
    redecided: redecidedCount(outcomes, round),
  };
}

/** Plain-language lines for {@link drawIntegrity}; empty when there is nothing to flag or confirm. */
export function drawIntegrityMessages(d: DrawIntegrity): {
  tone: "ok" | "warning";
  text: string;
}[] {
  const lines: { tone: "ok" | "warning"; text: string }[] = [];
  if (d.seed.status === "verified") {
    lines.push({
      tone: "ok",
      text: "Verifiable draw: the seed is derived from the recorded votes, so anyone can recompute it.",
    });
  } else if (d.seed.status === "unverifiable") {
    lines.push({
      tone: "warning",
      text: "Legacy / unverifiable draw: the recorded seed does not match the public derivation from the recorded votes. It was recorded before verifiable draws, or the outcome was changed afterwards.",
    });
  }
  if (d.redecided > 0) {
    lines.push({
      tone: "warning",
      text: `This round was re-decided ${d.redecided} ${d.redecided === 1 ? "time" : "times"}. Every earlier outcome is kept in the history.`,
    });
  }
  return lines;
}
