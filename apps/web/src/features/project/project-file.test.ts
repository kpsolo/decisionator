import "fake-indexeddb/auto";
import { createProjectWorkbook, runTally } from "@decisionator/core";
import { FileProjectStore } from "@decisionator/store-file";
import { bordaStrategy } from "@decisionator/strategy-borda";
import { describe, expect, it } from "vitest";
import { readProjectFile, restoreProject, snapshotToExport } from "./project-file.js";

const OWNER = "owner@device";

async function seededProject() {
  const store = new FileProjectStore(OWNER, `export-src-${Math.random()}`);
  const ref = await store.createProject({
    title: "Team offsite",
    description: "Where should we go?",
    voting: { state: "open", round: 1, topN: 3, liveResults: true },
    options: [
      { id: "lis", title: "Lisbon", pros: ["Direct flights"], tags: ["sun"] } as never,
      { id: "alp", title: "Alps lodge", category: "Europe" } as never,
      { id: "bcn", title: "Barcelona" } as never,
    ],
  });
  await store.append(ref, [
    { kind: "grade", optionId: "lis", value: 5 },
    { kind: "comment", optionId: "lis", body: "Strong pick" },
    { kind: "ranking", ranking: ["lis", "bcn", "alp"], round: 1 },
  ]);
  await store.append(
    ref,
    [
      { kind: "grade", optionId: "bcn", value: 4 },
      { kind: "ranking", ranking: ["bcn", "lis"], round: 1 },
    ],
    { onBehalfOf: { participantId: "guest:ana", displayName: "Ana" } }
  );
  const snap = await store.openProject(ref);
  const outcome = await runTally({
    snapshot: snap,
    strategy: bordaStrategy,
    strategyId: "org.decisionator.strategy.borda",
    strategyVersion: "0.1.0",
    triggeredBy: OWNER,
  });
  await store.append(ref, [
    { kind: "outcome", outcome },
    {
      kind: "contribution",
      contribution: {
        id: "k1",
        at: "2026-10-06T00:00:00.000Z",
        by: "agent:1",
        targetKind: "option",
        targetId: "lis",
        type: "note",
        body: "Cheapest in October",
        author: { kind: "agent", agentName: "Claude" },
        reviewStatus: "pending",
      },
    },
  ]);
  return store.openProject(ref);
}

/** Exported content without the ids and times a store assigns when it records entries. */
function comparable(snapshot: Awaited<ReturnType<FileProjectStore["openProject"]>>) {
  const bundle = snapshotToExport(snapshot);
  const strip = <T extends { id?: string; at?: string }>(list: T[]) =>
    list.map(({ id: _id, at: _at, ...rest }) => rest);
  return {
    project: bundle.project,
    options: bundle.options.map(({ by: _by, at: _at, ...rest }) => rest),
    grades: strip(bundle.grades),
    comments: strip(bundle.comments),
    rankings: strip(bundle.rankings),
    outcomes: bundle.outcomes,
    contributions: bundle.contributions,
  };
}

describe("project export files", () => {
  it.each(["json", "xlsx"] as const)(
    "restores options, votes, comments, outcomes and contributions from %s",
    async (format) => {
      const original = await seededProject();
      const bundle = snapshotToExport(original);
      const file =
        format === "json"
          ? new Blob([JSON.stringify(bundle)])
          : new Blob([createProjectWorkbook(bundle) as Uint8Array<ArrayBuffer>]);

      const target = new FileProjectStore(OWNER, `export-dst-${Math.random()}`);
      const ref = await restoreProject(target, await readProjectFile(file));
      const restored = await target.openProject(ref);

      expect(comparable(restored)).toEqual(comparable(original));
      // Verification re-runs the strategy with these recorded inputs.
      expect(restored.outcomes[0]?.inputs).toMatchObject({ settings: { topN: 3 } });
      // Guest entries keep their author instead of becoming the restorer's.
      expect(restored.rankings.find((r) => r.by === "guest:ana")?.byName).toBe("Ana");
    }
  );

  it("rejects files that are not project exports", async () => {
    await expect(readProjectFile(new Blob(["hello"]))).rejects.toThrow(/neither a project JSON/);
    await expect(readProjectFile(new Blob(['{"format":"x"}']))).rejects.toThrow(/format/);
  });
});
