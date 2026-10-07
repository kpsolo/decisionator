import { type OutcomeRecord, runTally } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import {
  type StrategyDescriptor,
  checkInput,
  chosenStrategy,
  defaultSettings,
} from "./strategies.js";

/** One strategy's preview on the project's current votes (contract `strategy-choice`). */
export type ComparisonRow =
  | {
      strategyId: string;
      name: string;
      ok: true;
      order: string[];
      winner: string;
      seed?: string;
      differsFromChosen: boolean;
      /** The unrecorded outcome, ready to adopt. */
      outcome: OutcomeRecord;
    }
  | { strategyId: string; name: string; ok: false; reason: string; differsFromChosen: false };

/**
 * A seed derived from the tally inputs, so reopening the comparison (or adopting a row) gives the
 * same draw for the same votes.
 */
export async function inputSeed(snapshot: ProjectSnapshot): Promise<string> {
  const { options, ballots, grades } = checkInput(snapshot, {});
  const canonical = JSON.stringify({
    options: options.map((o) => o.id).sort(),
    ballots: [...ballots].sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : 0)),
    grades: [...grades]
      .map((g) => [g.optionId, g.average] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Runs every given strategy on the same snapshot without recording anything. */
export async function compareStrategies(
  snapshot: ProjectSnapshot,
  strategies: StrategyDescriptor[],
  triggeredBy: string
): Promise<ComparisonRow[]> {
  const seed = await inputSeed(snapshot);
  const chosen = chosenStrategy(snapshot, strategies);
  const rows: ComparisonRow[] = [];
  for (const s of strategies) {
    const settings = s.id === chosen.id ? chosen.settings : defaultSettings(s.id, snapshot.project);
    const check = s.strategy.check(checkInput(snapshot, settings));
    if (!check.ok) {
      rows.push({
        strategyId: s.id,
        name: s.name,
        ok: false,
        reason: check.reason ?? "Cannot decide with the current votes.",
        differsFromChosen: false,
      });
      continue;
    }
    try {
      const outcome = await runTally({
        snapshot,
        strategy: s.strategy,
        strategyId: s.id,
        strategyVersion: s.version,
        triggeredBy,
        settings,
        runInput: typeof settings.pick === "string" ? settings.pick : undefined,
        usesRandomness: s.usesRandomness,
        seed,
      });
      rows.push({
        strategyId: s.id,
        name: s.name,
        ok: true,
        order: outcome.result.order.map((o: { optionId: string }) => o.optionId),
        winner: outcome.result.winner,
        ...(s.usesRandomness ? { seed } : {}),
        differsFromChosen: false,
        outcome,
      });
    } catch (err) {
      rows.push({
        strategyId: s.id,
        name: s.name,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        differsFromChosen: false,
      });
    }
  }
  const chosenRow = rows.find((r) => r.strategyId === chosen.id);
  const chosenWinner = chosenRow?.ok ? chosenRow.winner : undefined;
  return rows.map((r) =>
    r.ok && chosenWinner !== undefined ? { ...r, differsFromChosen: r.winner !== chosenWinner } : r
  );
}
