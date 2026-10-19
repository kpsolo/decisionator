import type { Rng, StrategyInput, StrategyPlugin, StrategyResult } from "@decisionator/plugin-sdk";

export const STRATEGY_BORDA_ID = "org.decisionator.strategy.borda";

export interface BordaSettings {
  topN?: number; // 1 to 10, default 3
}

export interface BordaOrderItem {
  optionId: string;
  points: number;
  firstPlaces: number;
}

export interface BordaDecideResult extends StrategyResult {
  order: BordaOrderItem[];
  /** How first and second place were separated. */
  tieBreak: "none" | "average-grade" | "first-places" | "seeded-random";
  /** Set whenever any group of fully tied options was drawn, so the whole order can be replayed. */
  seedUsed?: string;
}

/** Sort keys, all "higher wins": points, average grade, first places. */
type Keys = readonly [number, number, number];

const sameKeys = (a: Keys, b: Keys) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export const bordaStrategy: StrategyPlugin = {
  check(input: StrategyInput) {
    if (!input.options || input.options.length < 2) {
      return { ok: false, reason: "Borda strategy requires at least 2 options to rank." };
    }
    return { ok: true };
  },

  decide(input: StrategyInput, rng: Rng): BordaDecideResult {
    const settings = (input.settings as BordaSettings) || {};
    const topN = Math.max(1, Math.min(10, settings.topN ?? 3));

    const options = input.options;
    const ballots = input.ballots || [];
    const grades = input.grades || [];

    // Map grades for quick lookup
    const gradeMap = new Map<string, number>();
    for (const g of grades) {
      gradeMap.set(g.optionId, g.average);
    }

    // Initialize tallies
    const pointsMap = new Map<string, number>();
    const firstPlacesMap = new Map<string, number>();
    for (const opt of options) {
      pointsMap.set(opt.id, 0);
      firstPlacesMap.set(opt.id, 0);
    }

    // Tally ballots: rank r on a top-N ballot earns N - r + 1 points, unranked earn 0
    for (const ballot of ballots) {
      const ranked = ballot.ranking.slice(0, topN);
      for (let r = 0; r < ranked.length; r++) {
        const optId = ranked[r];
        if (optId && pointsMap.has(optId)) {
          const currentPts = pointsMap.get(optId) ?? 0;
          const awarded = topN - r; // rank 0 earns topN, rank topN-1 earns 1
          pointsMap.set(optId, currentPts + awarded);

          if (r === 0) {
            const firsts = firstPlacesMap.get(optId) ?? 0;
            firstPlacesMap.set(optId, firsts + 1);
          }
        }
      }
    }

    // Tie-break chain:
    // 1. Points (higher wins)
    // 2. Average Grade (higher wins)
    // 3. First places (more wins)
    // 4. Seeded random draw (Rng)
    //
    // Sort by the deterministic keys only. The sort is stable, so fully tied options keep their
    // input order; each such group is then shuffled with an unbiased Fisher-Yates draw. Randomness
    // never enters the comparator: that is biased and depends on the engine's sort algorithm.
    const keyed = options.map((opt) => ({
      opt,
      keys: [
        pointsMap.get(opt.id) ?? 0,
        gradeMap.get(opt.id) ?? 0,
        firstPlacesMap.get(opt.id) ?? 0,
      ] as Keys,
    }));
    keyed.sort((a, b) => b.keys[0] - a.keys[0] || b.keys[1] - a.keys[1] || b.keys[2] - a.keys[2]);

    let usedRandomness = false;
    let start = 0;
    while (start < keyed.length) {
      const startKeys = keyed[start]?.keys;
      let end = start + 1;
      for (; end < keyed.length; end++) {
        const nextKeys = keyed[end]?.keys;
        if (!startKeys || !nextKeys || !sameKeys(startKeys, nextKeys)) break;
      }
      if (end - start > 1) {
        usedRandomness = true;
        for (let i = end - 1; i > start; i--) {
          const j = start + rng.int(i - start + 1);
          const a = keyed[i];
          const b = keyed[j];
          if (a && b) {
            keyed[i] = b;
            keyed[j] = a;
          }
        }
      }
      start = end;
    }

    // Report only how first and second place were separated.
    let tieBreak: BordaDecideResult["tieBreak"] = "none";
    const first = keyed[0]?.keys;
    const second = keyed[1]?.keys;
    if (first && second && first[0] === second[0]) {
      if (first[1] !== second[1]) tieBreak = "average-grade";
      else if (first[2] !== second[2]) tieBreak = "first-places";
      else tieBreak = "seeded-random";
    }

    const sorted = keyed.map((k) => k.opt);

    const order: BordaOrderItem[] = sorted.map((opt) => ({
      optionId: opt.id,
      points: pointsMap.get(opt.id) ?? 0,
      firstPlaces: firstPlacesMap.get(opt.id) ?? 0,
    }));

    const winner = sorted[0];
    const chosen = winner ? [winner.id] : [];

    const explanation = `**Borda Count Ranking**: Winner is **${winner?.title || "None"}** with ${pointsMap.get(winner?.id || "") ?? 0} points. Tie-break: ${tieBreak}.`;

    return {
      chosen,
      order,
      tieBreak,
      seedUsed: usedRandomness ? rng.seed : undefined,
      explanation,
    };
  },
};

export default bordaStrategy;
