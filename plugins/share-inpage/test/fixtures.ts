import { type Option, effectiveEntries, monotonicNow } from "@decisionator/core";
import {
  type Delegate,
  type Entry,
  type ProjectSnapshot,
  resetRecord,
} from "@decisionator/plugin-sdk";
import { randomId } from "../src/crypto.js";
import type { HostedProject } from "../src/hosted-project.js";
import { type Link, createLink, createPipePair } from "../src/link.js";

export const OWNER = "owner@device";

export function option(id: string, status: Option["status"] = "active"): Option {
  return {
    id,
    order: 1,
    title: `Option ${id}`,
    description: "",
    status,
    tags: [],
    pros: [],
    cons: [],
    links: [],
    at: "2026-10-06T00:00:00Z",
    by: OWNER,
  };
}

export function baseSnapshot(patch: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      title: "Lunch",
      description: "",
      protected: false,
      formatVersion: 2,
      voting: { state: "open", round: 1, topN: 3, liveResults: true },
    },
    options: [option("a"), option("b"), option("c"), option("gone", "removed")],
    grades: [],
    comments: [],
    rankings: [],
    outcomes: [],
    contributions: [],
    properties: [],
    role: "owner",
    ...patch,
  };
}

/**
 * An in-memory project with store semantics (every entry kept; latest-wins and resets applied
 * with `effectiveEntries`) and a deliberately slow
 * read-modify-write, so concurrent appends would lose updates if the host did not serialize them.
 */
export class FakeProject implements HostedProject {
  appendCalls: { participant: Delegate; entries: Entry[] }[] = [];
  failNext: Error | null = null;
  private listeners = new Set<(s: ProjectSnapshot) => void>();

  constructor(public state: ProjectSnapshot = baseSnapshot()) {}

  async snapshot(): Promise<ProjectSnapshot> {
    return structuredClone(this.state);
  }

  watch(onChange: (s: ProjectSnapshot) => void) {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }

  /** The owner changing voting settings, which stores report through watch(). */
  ownerSetVoting(voting: NonNullable<ProjectSnapshot["project"]["voting"]>): void {
    this.state = { ...this.state, project: { ...this.state.project, voting } };
    for (const cb of this.listeners) cb(structuredClone(this.state));
  }

  /** The owner acting in their own tab. */
  async ownerAppend(entries: Entry[]): Promise<void> {
    await this.write({ participantId: OWNER }, entries);
  }

  async appendFor(participant: Delegate, entries: Entry[]): Promise<void> {
    this.appendCalls.push({ participant, entries });
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    await this.write(participant, entries);
  }

  private async write(who: Delegate, entries: Entry[]): Promise<void> {
    const doc = structuredClone(this.state);
    await new Promise((r) => setTimeout(r, 1));
    const by = who.participantId;
    const byName = who.displayName ? { byName: who.displayName } : {};
    // Store semantics: keep every entry, derive the effective arrays and history on read.
    const past = doc.history;
    const log = {
      grades: inAppendOrder([...(past?.grades ?? []), ...doc.grades]),
      rankings: inAppendOrder([...(past?.rankings ?? []), ...doc.rankings]),
      properties: inAppendOrder([...(past?.properties ?? []), ...(doc.properties ?? [])]),
      resets: [...(past?.resets ?? [])],
    };
    for (const e of entries) {
      const at = monotonicNow();
      if (e.kind === "grade") {
        log.grades.push({
          id: randomId(6),
          at,
          by,
          optionId: e.optionId,
          value: e.value,
          ...byName,
        });
      } else if (e.kind === "comment") {
        doc.comments.push({
          id: randomId(6),
          at,
          by,
          optionId: e.optionId,
          body: e.body,
          ...(e.replaces ? { replaces: e.replaces } : {}),
          ...byName,
        });
      } else if (e.kind === "ranking") {
        const round = e.round ?? 1;
        log.rankings.push({ id: randomId(6), at, by, round, ranking: e.ranking, ...byName });
      } else if (e.kind === "property") {
        log.properties.push({
          id: randomId(6),
          at,
          by,
          optionId: e.optionId,
          plugin: e.plugin,
          key: e.key,
          scope: e.scope,
          value: e.value,
          ...byName,
        });
      } else if (e.kind === "reset") {
        log.resets.push(resetRecord(e, { id: randomId(6), at, by, ...byName }));
      }
    }
    const effective = effectiveEntries(log);
    doc.grades = effective.grades;
    doc.rankings = effective.rankings;
    doc.properties = effective.properties;
    doc.history = effective.history;
    this.state = doc;
    for (const cb of this.listeners) cb(structuredClone(doc));
  }
}

function inAppendOrder<T extends { at: string }>(list: T[]): T[] {
  return list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** A link pair whose host end is handed to `accept`; returns the guest end. */
export function connectPair(accept: (link: Link) => void): Link {
  const [hostPipe, guestPipe] = createPipePair();
  accept(createLink(hostPipe));
  return createLink(guestPipe);
}

export async function flush(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}
