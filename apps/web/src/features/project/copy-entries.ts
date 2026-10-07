import type {
  Comment,
  Contribution,
  Grade,
  OutcomeRecord,
  PropertyValue,
  Ranking,
  Reset,
} from "@decisionator/core";
import {
  type Entry,
  type ProjectRef,
  type ProjectStore,
  isSelfPropertyReset,
} from "@decisionator/plugin-sdk";

export interface EntriesToCopy {
  /** Effective grades, ballots and property values (latest per slot, resets applied). */
  grades: Grade[];
  comments: Comment[];
  rankings: Ranking[];
  outcomes: OutcomeRecord[];
  contributions?: Contribution[];
  /** Option property values (contract option-properties 1.0.0), cleared (`null`) ones included. */
  properties?: PropertyValue[];
  /**
   * Superseded and cleared entries (contract `history-resets`). A snapshot carries its resets
   * here; an export bundle carries them in {@link EntriesToCopy.resets}.
   */
  history?: {
    grades?: Grade[];
    rankings?: Ranking[];
    properties?: PropertyValue[];
    resets?: Reset[];
  };
  resets?: Reset[];
}

interface TimelineItem {
  at: string;
  /** Who the entry is appended as: the signed-in user or the participant it is delegated to. */
  author: string;
  entry: Entry;
  /** Insertion order, the last tie-break. */
  seq: number;
}

const propertyEntry = (p: PropertyValue): Entry => ({
  kind: "property",
  optionId: p.optionId,
  plugin: p.plugin,
  key: p.key,
  scope: p.scope,
  value: p.value,
});

const resetEntry = (r: Reset): Entry => ({
  kind: "reset",
  scope: r.scope,
  targets: [...r.targets],
  ...(r.participantId !== undefined ? { participantId: r.participantId } : {}),
  ...(r.round !== undefined ? { round: r.round } : {}),
  ...(r.plugin !== undefined && r.key !== undefined ? { plugin: r.plugin, key: r.key } : {}),
});

/**
 * Re-creates grades, comments, rankings, property values and resets in `ref` under their
 * original authors. Entries of other participants are appended on their behalf (ProjectStore
 * contract v1.2.0), so moving a project keeps one vote per collaborator instead of collapsing
 * them all into the mover's.
 *
 * History entries, effective entries and resets are merged into one list in their original time
 * order and appended in that order, consecutive entries by the same author in one call. The
 * store stamps new, increasing times, so every reset clears the same entries as before, the
 * effective state equals the original one and the history survives (contract `history-resets`).
 * A reset always starts a new call, so it is stamped strictly after the entries before it.
 *
 * Shared property values are recorded by the signed-in user, since only the owner may set them.
 * A reset someone made of their own property values is recorded on their behalf; any other reset
 * by the signed-in user (only the owner may append those), with its scope and participant
 * unchanged. Outcomes and contributions follow as-is, by the signed-in user (they carry their
 * own author fields).
 */
export async function copyEntriesAsAuthors(
  targetStore: ProjectStore,
  ref: ProjectRef,
  source: EntriesToCopy
): Promise<void> {
  const { participantId: me } = await targetStore.signIn({ interactive: false });

  const names = new Map<string, string>();
  const items: TimelineItem[] = [];
  const add = (at: string, author: string, byName: string | undefined, entry: Entry) => {
    if (byName && author !== me) names.set(author, byName);
    items.push({ at, author, entry, seq: items.length });
  };

  const history = source.history ?? {};
  for (const g of [...(history.grades ?? []), ...source.grades]) {
    add(g.at, g.by, g.byName, { kind: "grade", optionId: g.optionId, value: g.value });
  }
  for (const c of source.comments) {
    add(c.at, c.by, c.byName, {
      kind: "comment",
      optionId: c.optionId,
      body: c.body,
      hidden: c.hidden,
    });
  }
  for (const r of [...(history.rankings ?? []), ...source.rankings]) {
    add(r.at, r.by, r.byName, { kind: "ranking", ranking: r.ranking, round: r.round });
  }
  for (const p of [...(history.properties ?? []), ...(source.properties ?? [])]) {
    if (p.scope === "person") add(p.at, p.by, p.byName, propertyEntry(p));
    else add(p.at, me, undefined, propertyEntry(p));
  }
  const resets = source.resets?.length ? source.resets : (history.resets ?? []);
  for (const r of resets) {
    const entry = resetEntry(r);
    if (isSelfPropertyReset(entry, r.by)) add(r.at, r.by, r.byName, entry);
    else add(r.at, me, undefined, entry);
  }

  // Original time order. On equal times a reset goes first (it only clears strictly earlier
  // entries), then authors in order of first appearance, then insertion order (history before
  // effective, so the effective entry still wins its slot).
  const authorRank = new Map<string, number>();
  for (const item of items) {
    if (!authorRank.has(item.author)) authorRank.set(item.author, authorRank.size);
  }
  const isReset = (item: TimelineItem) => (item.entry.kind === "reset" ? 0 : 1);
  items.sort(
    (a, b) =>
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) ||
      isReset(a) - isReset(b) ||
      (authorRank.get(a.author) ?? 0) - (authorRank.get(b.author) ?? 0) ||
      a.seq - b.seq
  );

  const runs: { author: string; entries: Entry[] }[] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && last.author === item.author && item.entry.kind !== "reset") {
      last.entries.push(item.entry);
    } else {
      runs.push({ author: item.author, entries: [item.entry] });
    }
  }

  for (const run of runs) {
    if (run.author === me) {
      await targetStore.append(ref, run.entries);
    } else {
      const displayName = names.get(run.author);
      await targetStore.append(ref, run.entries, {
        onBehalfOf: {
          participantId: run.author,
          ...(displayName !== undefined ? { displayName } : {}),
        },
      });
    }
  }

  if (source.outcomes.length > 0) {
    await targetStore.append(
      ref,
      source.outcomes.map((outcome) => ({ kind: "outcome" as const, outcome }))
    );
  }

  if (source.contributions?.length) {
    await targetStore.append(
      ref,
      source.contributions.map((contribution) => ({
        kind: "contribution" as const,
        contribution,
      }))
    );
  }
}
