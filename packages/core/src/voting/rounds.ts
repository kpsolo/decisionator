import type { Option, Ranking, VotingState } from "../model/index.js";

export type ExtendedVotingState = VotingState & {
  closedAt?: string;
};

export interface EffectiveBallot {
  by: string;
  round: number;
  ranking: string[];
  at: string;
}

/**
 * State machine transition:
 * open(n) -> closed(n)
 * closed(n) -> open(n + 1)
 */
export function openNextRound(
  current: ExtendedVotingState,
  options?: { topN?: number; liveResults?: boolean }
): ExtendedVotingState {
  if (current.state !== "closed") {
    throw new Error(`Cannot open next round: current state is ${current.state}`);
  }
  return {
    state: "open",
    round: current.round + 1,
    topN: options?.topN ?? current.topN,
    liveResults: options?.liveResults ?? current.liveResults,
    closedAt: undefined,
  };
}

export function closeVotingRound(
  current: ExtendedVotingState,
  at = new Date().toISOString()
): ExtendedVotingState {
  if (current.state !== "open") {
    throw new Error(`Cannot close round: current state is ${current.state}`);
  }
  return {
    ...current,
    state: "closed",
    closedAt: at,
  };
}

/**
 * Computes effective ballots for a given round:
 * - Latest ballot per participant
 * - Submitted at or before closedAt (if closed)
 * - Sanitized: unique option IDs, <= topN, and only from active options
 */
export function getEffectiveBallots(
  rankings: Ranking[],
  round: number,
  activeOptions: Option[],
  topN: number,
  closedAt?: string
): EffectiveBallot[] {
  const activeIds = new Set(activeOptions.filter((o) => o.status === "active").map((o) => o.id));

  // Filter for round and time limit
  const eligible = rankings.filter((r) => {
    if ((r.round ?? 1) !== round) return false;
    if (closedAt && r.at > closedAt) return false;
    return true;
  });

  // Sort chronologically ascending
  eligible.sort((a, b) => a.at.localeCompare(b.at));

  // Map participant -> latest valid ballot
  const latestByParticipant = new Map<string, Ranking>();
  for (const r of eligible) {
    latestByParticipant.set(r.by, r);
  }

  const result: EffectiveBallot[] = [];

  for (const [by, r] of latestByParticipant.entries()) {
    // Sanitize ranking: keep only unique active option IDs, truncated to topN
    const seen = new Set<string>();
    const sanitizedRanking: string[] = [];

    for (const optId of r.ranking) {
      if (activeIds.has(optId) && !seen.has(optId)) {
        seen.add(optId);
        sanitizedRanking.push(optId);
        if (sanitizedRanking.length >= topN) {
          break;
        }
      }
    }

    if (sanitizedRanking.length > 0) {
      result.push({
        by,
        round,
        ranking: sanitizedRanking,
        at: r.at,
      });
    }
  }

  return result;
}

/**
 * The most recent outcome of `round` (by `at`; on equal times the later-recorded one), or of the
 * whole project when no outcome belongs to that round. Re-deciding with another strategy appends
 * an outcome, so the latest one is the ranking currently in force.
 */
export function latestOutcome<T extends { round?: number; at: string }>(
  outcomes: readonly T[],
  round?: number
): T | undefined {
  const pickLatest = (list: readonly T[]) =>
    list.reduce<T | undefined>((best, o) => (!best || o.at >= best.at ? o : best), undefined);
  if (round !== undefined) {
    const inRound = pickLatest(outcomes.filter((o) => (o.round ?? 1) === round));
    if (inRound) return inRound;
  }
  return pickLatest(outcomes);
}
