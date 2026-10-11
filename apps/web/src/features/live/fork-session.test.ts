import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { FileProjectStore } from "@decisionator/store-file";
import { snapshotToExport, restoreProject } from "../project/project-file.js";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";

describe("Session Forking (User Story 4)", () => {
  it("restores a shared snapshot into a new independent store preserving author attributions and history", async () => {
    const sourceStore = new FileProjectStore("host@device", `source-store-${Math.random()}`);
    const hostRef = await sourceStore.createProject({
      title: "Shared Deliberation",
      description: "Collaborative decision across devices",
      voting: { state: "open", round: 1, topN: 2, liveResults: true },
      options: [
        { id: "opt-1", title: "Option Alpha" } as never,
        { id: "opt-2", title: "Option Beta" } as never,
      ],
    });

    // Host appends host grades and comments
    await sourceStore.append(hostRef, [
      { kind: "grade", optionId: "opt-1", value: 5 },
      { kind: "comment", optionId: "opt-1", body: "Host comment" },
      { kind: "ranking", ranking: ["opt-1", "opt-2"], round: 1 },
    ]);

    // Guest Gina appends grades, comments, rankings
    await sourceStore.append(
      hostRef,
      [
        { kind: "grade", optionId: "opt-2", value: 4 },
        { kind: "comment", optionId: "opt-2", body: "Gina's perspective" },
        { kind: "ranking", ranking: ["opt-2", "opt-1"], round: 1 },
      ],
      { onBehalfOf: { participantId: "guest:gina", displayName: "Gina" } }
    );

    // Host resets votes for Gina in round 1
    await sourceStore.append(hostRef, [
      {
        kind: "reset",
        scope: "participant",
        participantId: "guest:gina",
        targets: ["grades"],
      },
    ]);

    const sourceSnapshot = await sourceStore.openProject(hostRef);
    expect(sourceSnapshot.options).toHaveLength(2);
    expect(sourceSnapshot.comments).toHaveLength(2);
    expect(sourceSnapshot.history?.resets).toHaveLength(1);

    // Collaborator converts snapshot to export bundle
    const bundle = snapshotToExport(sourceSnapshot);
    expect(bundle.project.title).toBe("Shared Deliberation");
    expect(bundle.comments).toHaveLength(2);
    expect(bundle.resets).toHaveLength(1);

    // Collaborator restores project into their independent workspace
    const targetStore = new FileProjectStore("collaborator@device", `fork-store-${Math.random()}`);
    const forkedRef = await restoreProject(targetStore, bundle);
    expect(forkedRef).toBeDefined();

    const forkedSnapshot = await targetStore.openProject(forkedRef);
    expect(forkedSnapshot.project.title).toBe("Shared Deliberation");
    expect(forkedSnapshot.options).toHaveLength(2);

    // Verify author attributions are preserved
    const ginaComment = forkedSnapshot.comments.find((c) => c.body === "Gina's perspective");
    expect(ginaComment).toBeDefined();
    expect(ginaComment?.by).toBe("guest:gina");
    expect(ginaComment?.byName).toBe("Gina");

    const hostComment = forkedSnapshot.comments.find((c) => c.body === "Host comment");
    expect(hostComment).toBeDefined();
    expect(hostComment?.by).toBe("host@device");

    // Verify history and reset entries survived
    expect(forkedSnapshot.history?.resets).toHaveLength(1);
    expect(forkedSnapshot.history?.resets?.[0]?.participantId).toBe("guest:gina");
  });
});
