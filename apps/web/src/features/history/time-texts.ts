import type { EntryHistory, Grade, Ranking, Reset } from "@decisionator/core";

/**
 * Tooltip texts with times (FR-028, data-model "Tooltip texts"). Pure, so locale, time zone and
 * "now" are injectable for tests; the app passes nothing and gets the viewer's own settings.
 */

export interface TimeFormatOptions {
  locale?: string;
  timeZone?: string;
}

function formatter(opts: TimeFormatOptions, timeOnly: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(
    opts.locale,
    timeOnly
      ? { timeStyle: "short", timeZone: opts.timeZone }
      : { dateStyle: "medium", timeStyle: "short", timeZone: opts.timeZone }
  );
}

function dayKey(iso: string, opts: TimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: opts.timeZone,
  }).format(new Date(iso));
}

/**
 * Date and time in the viewer's locale and zone, e.g. "7 Oct 2026, 14:20". With `sameDayAs`,
 * only the time is shown when both fall on the same day ("14:05").
 */
export function formatTime(iso: string, opts: TimeFormatOptions = {}, sameDayAs?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const timeOnly = sameDayAs !== undefined && dayKey(iso, opts) === dayKey(sameDayAs, opts);
  return formatter(opts, timeOnly).format(date);
}

const EMPTY_HISTORY: EntryHistory = { grades: [], rankings: [], properties: [], resets: [] };

function byTime<T extends { at: string }>(a: T, b: T): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

/** Who a reset is attributed to: its recorded name, "you", or the owner (only owners reset votes). */
function resetAuthor(reset: Reset, viewerId: string | null): string {
  if (viewerId !== null && reset.by === viewerId) return "you";
  return reset.byName ?? "the owner";
}

function clearsGrade(reset: Reset, grade: Grade): boolean {
  return (
    reset.targets.includes("grades") &&
    (reset.scope === "all" || reset.participantId === grade.by) &&
    grade.at < reset.at
  );
}

function clearsBallot(reset: Reset, ballot: Ranking): boolean {
  return (
    reset.targets.includes("ballots") &&
    (reset.scope === "all" || reset.participantId === ballot.by) &&
    (reset.round === undefined || reset.round === (ballot.round ?? 1)) &&
    ballot.at < reset.at
  );
}

/**
 * The viewer's own grade: "You rated 4 · {time}" plus "Changed from 3 at {time}" when it
 * replaced an earlier grade, or "Reset by {name} · {time}" when the latest grade was cleared.
 * `undefined` when the viewer never graded the option.
 */
export function ownGradeText(input: {
  optionId: string;
  viewerId: string | null;
  grades: readonly Grade[];
  history?: EntryHistory;
  format?: TimeFormatOptions;
}): string | undefined {
  const { optionId, viewerId, format = {} } = input;
  if (viewerId === null) return undefined;
  const history = input.history ?? EMPTY_HISTORY;
  const mine = (g: Grade) => g.by === viewerId && g.optionId === optionId;
  const current = input.grades.find(mine);
  const earlier = history.grades.filter(mine).sort(byTime);
  if (current) {
    const lines = [`You rated ${current.value} · ${formatTime(current.at, format)}`];
    const previous = earlier.filter((g) => g.at < current.at).at(-1);
    if (previous) {
      lines.push(
        `Changed from ${previous.value} at ${formatTime(previous.at, format, current.at)}`
      );
    }
    return lines.join("\n");
  }
  const last = earlier.at(-1);
  if (!last) return undefined;
  const reset = history.resets
    .filter((r) => clearsGrade(r, last))
    .sort(byTime)
    .at(-1);
  if (!reset) return undefined;
  return `Reset by ${resetAuthor(reset, viewerId)} · ${formatTime(reset.at, format)}`;
}

/** "Last rating · {time}" for an option's average, from its effective grades. */
export function averageText(input: {
  optionId: string;
  grades: readonly Grade[];
  format?: TimeFormatOptions;
}): string | undefined {
  let latest: string | undefined;
  for (const g of input.grades) {
    if (g.optionId === input.optionId && (latest === undefined || g.at > latest)) latest = g.at;
  }
  return latest === undefined ? undefined : `Last rating · ${formatTime(latest, input.format)}`;
}

/**
 * The viewer's ballot for a round: "Submitted {first} · updated {latest}", or just
 * "Submitted {first}" when it never changed. Ballots cleared by a reset do not count as "first".
 */
export function ballotText(input: {
  viewerId: string | null;
  round: number;
  rankings: readonly Ranking[];
  history?: EntryHistory;
  format?: TimeFormatOptions;
}): string | undefined {
  const { viewerId, round, format = {} } = input;
  if (viewerId === null) return undefined;
  const history = input.history ?? EMPTY_HISTORY;
  const mine = (r: Ranking) => r.by === viewerId && (r.round ?? 1) === round;
  const current = input.rankings.find(mine);
  if (!current) return undefined;
  // The latest reset of this ballot before the current one starts a fresh "Submitted".
  const lastReset = history.resets
    .filter((r) => r.at < current.at && clearsBallot(r, { ...current, at: "" }))
    .map((r) => r.at)
    .sort()
    .at(-1);
  const since = [...history.rankings.filter(mine), current]
    .filter((r) => r.at <= current.at && (lastReset === undefined || r.at > lastReset))
    .sort(byTime);
  const first = since[0] ?? current;
  if (first.at === current.at) return `Submitted ${formatTime(first.at, format)}`;
  return `Submitted ${formatTime(first.at, format)} · updated ${formatTime(current.at, format, first.at)}`;
}

export interface ParticipantRating {
  name: string;
  value: number;
  at: string;
}

/** Each participant's effective grade for an option, by name (owner view, FR-029). */
export function optionRatings(
  optionId: string,
  grades: readonly Grade[],
  nameOf: (id: string) => string | undefined = () => undefined
): ParticipantRating[] {
  return grades
    .filter((g) => g.optionId === optionId)
    .map((g) => ({ name: g.byName ?? nameOf(g.by) ?? g.by, value: g.value, at: g.at }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "{name} {v} · {time}", with only the time when it was today. */
export function ratingLine(
  rating: ParticipantRating,
  format: TimeFormatOptions = {},
  now: Date = new Date()
): string {
  return `${rating.name} ${rating.value} · ${formatTime(rating.at, format, now.toISOString())}`;
}
