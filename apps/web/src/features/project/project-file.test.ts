import "fake-indexeddb/auto";
import { createProjectWorkbook, runTally } from "@decisionator/core";
import { redactSnapshotFor } from "@decisionator/share-inpage";
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
      {
        kind: "property",
        optionId: "lis",
        plugin: "org.decisionator.option-status",
        key: "seen",
        scope: "person",
        value: "seen_auto",
      },
    ],
    { onBehalfOf: { participantId: "guest:ana", displayName: "Ana" } }
  );
  await store.append(ref, [
    {
      kind: "property",
      optionId: "bcn",
      plugin: "org.example.budget",
      key: "cost",
      scope: "shared",
      value: 1200,
    },
    {
      kind: "property",
      optionId: "lis",
      plugin: "org.example.budget",
      key: "approved",
      scope: "shared",
      value: false,
    },
  ]);
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
    properties: [...bundle.properties]
      .map(({ id: _id, at: _at, ...rest }) => rest)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

describe("project export files", () => {
  it.each(["json", "xlsx"] as const)(
    "restores options, votes, comments, outcomes, contributions and properties from %s",
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
      // A guest's person value stays the guest's; shared values keep their JSON types.
      const props = restored.properties ?? [];
      expect(props).toHaveLength(3);
      expect(props.find((p) => p.scope === "person")).toMatchObject({
        by: "guest:ana",
        byName: "Ana",
        optionId: "lis",
        plugin: "org.decisionator.option-status",
        key: "seen",
        value: "seen_auto",
      });
      expect(props.filter((p) => p.scope === "shared").map((p) => [p.by, p.key, p.value])).toEqual(
        expect.arrayContaining([
          [OWNER, "cost", 1200],
          [OWNER, "approved", false],
        ])
      );
    }
  );

  it("lets a live-session guest save a copy that opens and holds only what they could see", async () => {
    const seeded = await seededProject();
    const owners = seeded.comments.find((c) => c.by === OWNER);
    const snapshot = {
      ...seeded,
      project: {
        ...seeded.project,
        voting: { state: "open" as const, round: 1, topN: 3, liveResults: false },
      },
      comments: seeded.comments.map((c) => (c === owners ? { ...c, hidden: true } : c)),
    };
    const guestView = redactSnapshotFor(snapshot, "guest:ana", "contribute");

    const bundle = await readProjectFile(new Blob([JSON.stringify(snapshotToExport(guestView))]));

    expect(bundle.options.map((o) => o.title)).toEqual(["Lisbon", "Alps lodge", "Barcelona"]);
    expect(bundle.grades.map((g) => [g.by, g.value])).toContainEqual(["guest:ana", 4]);
    expect(bundle.comments.find((c) => c.id === owners?.id)?.body).toBe("");
    expect(JSON.stringify(bundle)).not.toContain("Strong pick");
    expect(bundle.rankings.map((r) => r.by)).toEqual(["guest:ana"]);
    expect(bundle.contributions).toEqual([]);
  });

  it("rejects files that are not project exports", async () => {
    await expect(readProjectFile(new Blob(["hello"]))).rejects.toThrow(/neither a project JSON/);
    await expect(readProjectFile(new Blob(['{"format":"x"}']))).rejects.toThrow(/format/);
  });
});
