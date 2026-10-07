import { z } from "zod";
import type { Grade, Ranking } from "./entries.js";
import { type PropertyValue, propertySlot } from "./property.js";

/**
 * History and resets (ProjectStore 1.4.0, contract `history-resets`). Stores keep every grade,
 * ballot and property entry; a `reset` entry clears earlier entries without deleting them.
 * {@link effectiveEntries} is the single place where latest-wins and resets are applied.
 */

export const ResetTargetSchema = z.enum(["grades", "ballots", "properties"]);
export type ResetTarget = z.infer<typeof ResetTargetSchema>;

export const ResetFieldsSchema = z
  .object({
    scope: z.enum(["all", "participant"]),
    participantId: z.string().min(1).max(200).optional(),
    targets: z.array(ResetTargetSchema).min(1).max(3),
    round: z.number().int().min(1).optional(),
    plugin: z.string().min(1).max(200).optional(),
    key: z.string().min(1).max(40).optional(),
  })
  .superRefine((r, ctx) => {
    if (new Set(r.targets).size !== r.targets.length) {
      ctx.addIssue({ code: "custom", path: ["targets"], message: "targets must be unique" });
    }
    if (r.scope === "participant" && !r.participantId) {
      ctx.addIssue({
        code: "custom",
        path: ["participantId"],
        message: "required for a participant reset",
      });
    }
    if (r.scope === "all" && r.participantId) {
      ctx.addIssue({
        code: "custom",
        path: ["participantId"],
        message: "not allowed for an all reset",
      });
    }
    if ((r.plugin === undefined) !== (r.key === undefined)) {
      ctx.addIssue({ code: "custom", path: ["plugin"], message: "plugin and key go together" });
    }
  });
export type ResetFields = z.infer<typeof ResetFieldsSchema>;

export const ResetSchema = z.intersection(
  z.object({ id: z.string(), at: z.string(), by: z.string(), byName: z.string().optional() }),
  ResetFieldsSchema
);
export type Reset = z.infer<typeof ResetSchema>;

export interface EntryHistory {
  grades: Grade[];
  rankings: Ranking[];
  properties: PropertyValue[];
  resets: Reset[];
}

export interface EffectiveEntries {
  grades: Grade[];
  rankings: Ranking[];
  properties: PropertyValue[];
  history: EntryHistory;
}

function clears(r: Reset, target: ResetTarget, e: { by: string; at: string }): boolean {
  if (!r.targets.includes(target)) return false;
  if (r.scope === "participant" && e.by !== r.participantId) return false;
  // Strictly earlier: stores stamp strictly increasing times (see monotonicNow).
  return e.at < r.at;
}

function clearedBy(resets: readonly Reset[], test: (r: Reset) => boolean): boolean {
  return resets.some(test);
}

/**
 * Applies latest-wins and resets. Each input list must be in append order; later entries win
 * on equal times. Returns effective entries plus the superseded and cleared ones as history,
 * oldest first.
 */
export function effectiveEntries(input: {
  grades: readonly Grade[];
  rankings: readonly Ranking[];
  properties?: readonly PropertyValue[];
  resets?: readonly Reset[];
}): EffectiveEntries {
  const resets = [...(input.resets ?? [])];
  const history: EntryHistory = { grades: [], rankings: [], properties: [], resets };

  const latest = <T extends { at: string }>(list: readonly T[], slot: (e: T) => string) => {
    const winners = new Map<string, T>();
    const losers: T[] = [];
    for (const e of list) {
      const key = slot(e);
      const prev = winners.get(key);
      if (!prev) winners.set(key, e);
      else if (prev.at <= e.at) {
        losers.push(prev);
        winners.set(key, e);
      } else losers.push(e);
    }
    return { winners: [...winners.values()], losers };
  };

  const g = latest(input.grades, (e) => `${e.by}\u0000${e.optionId}`);
  const grades: Grade[] = [];
  for (const e of g.winners) {
    if (clearedBy(resets, (r) => clears(r, "grades", e))) history.grades.push(e);
    else grades.push(e);
  }
  history.grades.push(...g.losers);

  const k = latest(input.rankings, (e) => `${e.by}\u0000${e.round ?? 1}`);
  const rankings: Ranking[] = [];
  for (const e of k.winners) {
    const round = e.round ?? 1;
    const cleared = clearedBy(
      resets,
      (r) => (r.round === undefined || r.round === round) && clears(r, "ballots", e)
    );
    if (cleared) history.rankings.push(e);
    else rankings.push(e);
  }
  history.rankings.push(...k.losers);

  const p = latest(input.properties ?? [], propertySlot);
  const properties: PropertyValue[] = [];
  for (const e of p.winners) {
    const cleared = clearedBy(resets, (r) => {
      if (r.plugin !== undefined && (r.plugin !== e.plugin || r.key !== e.key)) return false;
      // An all-scope reset clears shared values only; person values need a participant reset.
      if (r.scope === "all" && e.scope !== "shared") return false;
      return clears(r, "properties", e);
    });
    if (cleared) history.properties.push(e);
    else properties.push(e);
  }
  history.properties.push(...p.losers);

  const byTime = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  history.grades.sort(byTime);
  history.rankings.sort(byTime);
  history.properties.sort(byTime);
  return { grades, rankings, properties, history };
}

let lastStamp = 0;

/**
 * The current time as ISO 8601, strictly later than any time this function returned before in
 * this process. Stores stamp entries with it, so "appended after" is decidable by time even for
 * entries written within the same millisecond.
 */
export function monotonicNow(): string {
  const now = Math.max(Date.now(), lastStamp + 1);
  lastStamp = now;
  return new Date(now).toISOString();
}
