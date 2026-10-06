export interface Rng {
  readonly seed: string;
  nextUint32(): number;
  int(maxExclusive: number): number;
  float(): number;
}

export interface BallotSnapshot {
  by: string;
  ranking: string[];
}

export interface StrategyInput {
  options: { id: string; title: string; weight?: number }[];
  ballots?: BallotSnapshot[];
  grades?: { optionId: string; average: number; count: number }[];
  settings: unknown;
  runInput?: unknown;
}

export interface StrategyResult {
  chosen: string[];
  explanation: string;
}

export interface StrategyPlugin {
  check(input: StrategyInput): { ok: true } | { ok: false; reason: string };
  decide(input: StrategyInput, rng: Rng): StrategyResult;
}
