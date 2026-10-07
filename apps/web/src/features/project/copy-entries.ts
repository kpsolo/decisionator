import type {
  Comment,
  Contribution,
  Grade,
  OutcomeRecord,
  PropertyValue,
  Ranking,
} from "@decisionator/core";
import type { Entry, ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";

export interface EntriesToCopy {
  grades: Grade[];
  comments: Comment[];
  rankings: Ranking[];
  outcomes: OutcomeRecord[];
  contributions?: Contribution[];
  /** Option property values (contract option-properties 1.0.0), cleared (`null`) ones included. */
  properties?: PropertyValue[];
}

/**
 * Re-creates grades, comments and rankings in `ref` under their original authors. Entries of
 * other participants are appended on their behalf (ProjectStore contract v1.2.0), so moving a
 * project keeps one vote per collaborator instead of collapsing them all into the mover's.
 * Outcomes and contributions are recorded as-is by the signed-in user (they carry their own
 * author fields). Person-scoped property values go with their author's other entries; shared ones
 * are recorded by the signed-in user, since only the owner may set them.
 */
export async function copyEntriesAsAuthors(
  targetStore: ProjectStore,
  ref: ProjectRef,
  source: EntriesToCopy
): Promise<void> {
  const { participantId: me } = await targetStore.signIn({ interactive: false });

  const groups = new Map<string, { byName?: string; entries: Entry[] }>();
  const add = (by: string, byName: string | undefined, entry: Entry) => {
    let group = groups.get(by);
    if (!group) {
      group = { entries: [] };
      groups.set(by, group);
    }
    if (byName) group.byName = byName;
    group.entries.push(entry);
  };

  for (const g of source.grades) {
    add(g.by, g.byName, { kind: "grade", optionId: g.optionId, value: g.value });
  }
  for (const c of source.comments) {
    add(c.by, c.byName, { kind: "comment", optionId: c.optionId, body: c.body, hidden: c.hidden });
  }
  for (const r of source.rankings) {
    add(r.by, r.byName, { kind: "ranking", ranking: r.ranking, round: r.round });
  }

  // Oldest first, so that when a slot appears twice the newest value is appended last and wins.
  const properties = [...(source.properties ?? [])].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  );
  const propertyEntry = (p: PropertyValue): Entry => ({
    kind: "property",
    optionId: p.optionId,
    plugin: p.plugin,
    key: p.key,
    scope: p.scope,
    value: p.value,
  });
  for (const p of properties) {
    if (p.scope === "person") add(p.by, p.byName, propertyEntry(p));
  }

  for (const [by, group] of groups) {
    if (by === me) {
      await targetStore.append(ref, group.entries);
    } else {
      await targetStore.append(ref, group.entries, {
        onBehalfOf: {
          participantId: by,
          ...(group.byName !== undefined ? { displayName: group.byName } : {}),
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

  const shared = properties.filter((p) => p.scope === "shared");
  if (shared.length > 0) {
    await targetStore.append(ref, shared.map(propertyEntry));
  }
}
