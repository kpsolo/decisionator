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
      /**
       * The draw seed, for strategies that use randomness. It is derived publicly from the round,
       * strategy and votes (strategy contract v1.2.0), so the preview and the recorded outcome
       * use the same seed and anyone can recompute it.
       */
      seed?: string;
      differsFromChosen: boolean;
      /** The unrecorded preview outcome. */
      preview: OutcomeRecord;
      /**
       * Re-runs this strategy on the same votes and returns the outcome to record. The seed is the
       * public derivation, so on unchanged votes the result equals the preview.
       */
      adopt(): Promise<OutcomeRecord>;
    }
  | { strategyId: string; name: string; ok: false; reason: string; differsFromChosen: false };

/** Runs every given strategy on the same snapshot without recording anything. */
export async function compareStrategies(
  snapshot: ProjectSnapshot,
  strategies: StrategyDescriptor[],
  triggeredBy: string
): Promise<ComparisonRow[]> {
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
    const tally = () =>
      runTally({
        snapshot,
        strategy: s.strategy,
        strategyId: s.id,
        strategyVersion: s.version,
        triggeredBy,
        settings,
        runInput: typeof settings.pick === "string" ? settings.pick : undefined,
        usesRandomness: s.usesRandomness,
      });
    try {
      const preview = await tally();
      rows.push({
        strategyId: s.id,
        name: s.name,
        ok: true,
        order: preview.result.order.map((o: { optionId: string }) => o.optionId),
        winner: preview.result.winner,
        ...(s.usesRandomness && preview.seed ? { seed: preview.seed } : {}),
        differsFromChosen: false,
        preview,
        adopt: tally,
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
