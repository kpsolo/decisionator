import type { Comment, Grade, Option, OutcomeRecord, Ranking } from "../index.js";
import { computeOptionStats, createRng, getEffectiveBallots } from "../index.js";

export interface TallyProjectSnapshot {
  project: {
    voting?: {
      state: "open" | "closed";
      round?: number;
      topN?: number;
      liveResults?: boolean;
    };
  };
  options: Option[];
  grades: Grade[];
  comments: Comment[];
  rankings: Ranking[];
}

export interface TallyStrategyInput {
  options: { id: string; title: string; weight?: number }[];
  ballots?: { by: string; ranking: string[] }[];
  grades?: { optionId: string; average: number; count: number }[];
  settings: unknown;
  runInput?: unknown;
}

export interface TallyStrategyPlugin {
  check(input: TallyStrategyInput): { ok: true } | { ok: false; reason: string };
  // biome-ignore lint/suspicious/noExplicitAny: returns decide result
  decide(input: TallyStrategyInput, rng: any): any;
}

export interface RunTallyOptions {
  snapshot: TallyProjectSnapshot;
  strategy: TallyStrategyPlugin;
  strategyId: string;
  strategyVersion: string;
  triggeredBy: string;
  settings?: unknown;
  runInput?: unknown;
  usesRandomness?: boolean;
  seed?: string; // Optional CSPRNG 32 hex chars, generated if not provided
}

function generateRandomSeed(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback for node or tests
  let hex = "";
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

/**
 * Tally host (T077, FR-024):
 * - Builds StrategyInput from project snapshot
 * - Generates CSPRNG 128-bit seed
 * - Runs strategy check and decide
 * - Assembles immutable OutcomeRecord
 */
export async function runTally({
  snapshot,
  strategy,
  strategyId,
  strategyVersion,
  triggeredBy,
  settings,
  runInput,
  usesRandomness,
  seed = generateRandomSeed(),
}: RunTallyOptions): Promise<OutcomeRecord> {
  const currentRound = snapshot.project.voting?.round ?? 1;
  const topN = snapshot.project.voting?.topN ?? 3;
  const closedAt = new Date().toISOString();

  // 1. Calculate effective ballots
  const effectiveBallots = getEffectiveBallots(
    snapshot.rankings,
    currentRound,
    snapshot.options,
    topN,
    closedAt
  );

  // 2. Compute aggregated grades
  const statsMap = computeOptionStats(snapshot.options, snapshot.grades, snapshot.comments);
  const gradesList = Array.from(statsMap.values()).map((s) => ({
    optionId: s.optionId,
    average: s.average,
    count: s.count,
  }));

  const effectiveSettings = settings !== undefined ? settings : { topN };

  // 3. Assemble StrategyInput
  const strategyInput: TallyStrategyInput = {
    options: snapshot.options
      .filter((o) => o.status === "active")
      .map((o) => ({ id: o.id, title: o.title })),
    ballots: effectiveBallots.map((b) => ({ by: b.by, ranking: b.ranking })),
    grades: gradesList,
    settings: effectiveSettings,
    runInput,
  };

  // 4. Validate strategy check
  const checkRes = strategy.check(strategyInput);
  if (!checkRes.ok) {
    throw new Error(`Strategy check failed: ${checkRes.reason}`);
  }

  // 5. Execute decide with deterministic counter-mode RNG
  const rng = createRng(seed);
  // biome-ignore lint/suspicious/noExplicitAny: Borda extended result returns order and tieBreak
  const decision = strategy.decide(strategyInput, rng) as any;

  const winner = decision.chosen[0] || decision.order?.[0]?.optionId || "";

  // If strategy declares usesRandomness or Borda used seeded-random, record seed
  const recordSeed =
    usesRandomness === true ||
    decision.tieBreak === "seeded-random" ||
    decision.seedUsed !== undefined;

  // 6. Build immutable OutcomeRecord
  const outcome: OutcomeRecord = {
    round: currentRound,
    strategy: {
      id: strategyId,
      version: strategyVersion,
    },
    settings: effectiveSettings as Record<string, unknown>,
    inputs: strategyInput as OutcomeRecord["inputs"],
    result: {
      winner,
      chosen: decision.chosen || [winner],
      order: decision.order || [{ optionId: winner }],
      explanation: decision.explanation || "",
    },
    tieBreak: decision.tieBreak || "none",
    seed: recordSeed ? seed : undefined,
    triggeredBy,
    at: closedAt,
  };

  return outcome;
}
