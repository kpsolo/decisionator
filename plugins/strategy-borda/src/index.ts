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
  tieBreak: "none" | "average-grade" | "first-places" | "seeded-random";
  seedUsed?: string;
}

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

    // Group options by points to sort and break ties
    // Tie-break chain:
    // 1. Points (higher wins)
    // 2. Average Grade (higher wins)
    // 3. First places (more wins)
    // 4. Seeded random draw (Rng)
    const tieBreakState: {
      type: "none" | "average-grade" | "first-places" | "seeded-random";
      seedUsed?: string;
    } = {
      type: "none",
    };

    // Helper comparator for deterministic tie break
    const sorted = [...options].sort((a, b) => {
      const ptsA = pointsMap.get(a.id) ?? 0;
      const ptsB = pointsMap.get(b.id) ?? 0;
      if (ptsA !== ptsB) {
        return ptsB - ptsA;
      }

      // Tie in points: check average grade
      const avgA = gradeMap.get(a.id) ?? 0;
      const avgB = gradeMap.get(b.id) ?? 0;
      if (avgA !== avgB) {
        if (tieBreakState.type === "none") tieBreakState.type = "average-grade";
        return avgB - avgA;
      }

      // Tie in average grade: check first places
      const fpA = firstPlacesMap.get(a.id) ?? 0;
      const fpB = firstPlacesMap.get(b.id) ?? 0;
      if (fpA !== fpB) {
        if (tieBreakState.type === "none" || tieBreakState.type === "average-grade") {
          tieBreakState.type = "first-places";
        }
        return fpB - fpA;
      }

      // Still tied: seeded random draw using rng
      tieBreakState.type = "seeded-random";
      tieBreakState.seedUsed = rng.seed;
      // Draw 0 or 1 uniformly
      const flip = rng.int(2);
      return flip === 0 ? -1 : 1;
    });

    const order: BordaOrderItem[] = sorted.map((opt) => ({
      optionId: opt.id,
      points: pointsMap.get(opt.id) ?? 0,
      firstPlaces: firstPlacesMap.get(opt.id) ?? 0,
    }));

    const winner = sorted[0];
    const chosen = winner ? [winner.id] : [];

    const explanation = `**Borda Count Ranking**: Winner is **${winner?.title || "None"}** with ${pointsMap.get(winner?.id || "") ?? 0} points. Tie-break: ${tieBreakState.type}.`;

    return {
      chosen,
      order,
      tieBreak: tieBreakState.type,
      seedUsed: tieBreakState.type === "seeded-random" ? tieBreakState.seedUsed : undefined,
      explanation,
    };
  },
};

export default bordaStrategy;
