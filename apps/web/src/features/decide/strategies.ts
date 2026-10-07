import type { Project } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { bordaStrategy } from "@decisionator/strategy-borda";
import { ownerPickStrategy } from "@decisionator/strategy-owner-pick";
import { randomStrategy } from "@decisionator/strategy-random";
import { weightedStrategy } from "@decisionator/strategy-weighted";
import type { InstalledPlugin } from "../plugins/plugin-registry.js";

/** Strategies the app can run, and the project's chosen one (contract `strategy-choice` 1.0.0). */

export interface StrategyDescriptor {
  id: string;
  name: string;
  version: string;
  description: string;
  usesRandomness: boolean;
  interactive?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: strategy plugin interface
  strategy: any;
}

export const BORDA_ID = "org.decisionator.strategy.borda";
export const OWNER_PICK_ID = "org.decisionator.strategy.owner-pick";
export const WEIGHTED_ID = "org.decisionator.strategy.weighted";

export const BUILTIN_STRATEGIES: StrategyDescriptor[] = [
  {
    id: BORDA_ID,
    name: "Borda Count Ranking",
    version: "0.1.0",
    description: "Points-based ranking over contributor ballots with deterministic tie-breaking.",
    usesRandomness: true,
    strategy: bordaStrategy,
  },
  {
    id: OWNER_PICK_ID,
    name: "Owner Direct Pick",
    version: "0.1.0",
    description: "The owner directly designates the winning option.",
    usesRandomness: false,
    interactive: true,
    strategy: ownerPickStrategy,
  },
  {
    id: "org.decisionator.strategy.random",
    name: "Uniform Random Draw",
    version: "0.1.0",
    description: "Fair, unweighted random selection with reproducible CSPRNG seed.",
    usesRandomness: true,
    strategy: randomStrategy,
  },
  {
    id: WEIGHTED_ID,
    name: "Random Weighted by Grades",
    version: "0.1.0",
    description: "Draws an option with probability proportional to its average grade.",
    usesRandomness: true,
    strategy: weightedStrategy,
  },
];

/** Display name of a strategy id; unknown (third-party) ids are shown as-is. */
export function strategyName(id: string): string {
  return BUILTIN_STRATEGIES.find((s) => s.id === id)?.name ?? id;
}

/** Built-in strategies whose plugin is installed and enabled (all of them when unknown). */
export function enabledStrategies(installed?: InstalledPlugin[]): StrategyDescriptor[] {
  if (!installed) return BUILTIN_STRATEGIES;
  return BUILTIN_STRATEGIES.filter((s) => installed.find((p) => p.id === s.id)?.enabled !== false);
}

/** Settings a strategy starts with for this project. */
export function defaultSettings(
  id: string,
  project: Pick<Project, "voting">
): Record<string, unknown> {
  if (id === BORDA_ID) return { topN: project.voting?.topN ?? 3 };
  if (id === WEIGHTED_ID) return { includeUngraded: false };
  return {};
}

export interface ChosenStrategy {
  id: string;
  name: string;
  version: string;
  settings: Record<string, unknown>;
  /** The runnable strategy, or null when it is not installed or not enabled. */
  descriptor: StrategyDescriptor | null;
  /** Whether the project stored a choice (false = the Borda default). */
  stored: boolean;
}

/** The project's chosen strategy, defaulting to Borda count with the voting top N. */
export function chosenStrategy(
  snapshot: Pick<ProjectSnapshot, "project">,
  available: StrategyDescriptor[] = BUILTIN_STRATEGIES
): ChosenStrategy {
  const stored = snapshot.project.strategy;
  const id = stored?.id ?? BORDA_ID;
  const descriptor = available.find((s) => s.id === id) ?? null;
  const settings = {
    ...defaultSettings(id, snapshot.project),
    ...(stored?.settings ?? {}),
  };
  if (id === BORDA_ID) settings.topN = snapshot.project.voting?.topN ?? settings.topN;
  return {
    id,
    name: strategyName(id),
    version: stored?.version ?? descriptor?.version ?? "0.1.0",
    settings,
    descriptor,
    stored: stored !== undefined,
  };
}

/** Input for a strategy's `check()`, built the same way runTally builds it. */
export function checkInput(snapshot: ProjectSnapshot, settings: Record<string, unknown>) {
  const active = snapshot.options.filter((o) => o.status === "active");
  const round = snapshot.project.voting?.round ?? 1;
  return {
    options: active.map((o) => ({ id: o.id, title: o.title })),
    ballots: snapshot.rankings
      .filter((r) => (r.round ?? 1) === round)
      .map((r) => ({ by: r.by, ranking: r.ranking })),
    grades: snapshot.grades.map((g) => ({ optionId: g.optionId, average: g.value, count: 1 })),
    settings,
    runInput: typeof settings.pick === "string" ? settings.pick : undefined,
  };
}

/** Why the chosen strategy cannot decide now, or null when it can. */
export function cannotRunReason(snapshot: ProjectSnapshot, chosen: ChosenStrategy): string | null {
  if (!chosen.descriptor) {
    return `${chosen.name} is not available. Choose another method before closing the vote.`;
  }
  const check = chosen.descriptor.strategy.check(checkInput(snapshot, chosen.settings));
  return check.ok ? null : (check.reason ?? "This method cannot decide with the current votes.");
}
