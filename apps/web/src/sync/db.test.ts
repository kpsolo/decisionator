import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  type DraftRecord,
  deleteDraft,
  enqueueWrite,
  getDraft,
  getQueuedWrites,
  getSnapshot,
  removeQueuedWrite,
  saveDraft,
  saveSnapshot,
} from "./db.js";

describe("IndexedDB Storage Layer", () => {
  it("saves, retrieves, and deletes draft records", async () => {
    const draft: DraftRecord = {
      id: "01J00000000000000000000001",
      pastedText: "Option A\nOption B",
      preview: [],
      warnings: [],
      updatedAt: new Date().toISOString(),
    };

    await saveDraft(draft);
    const retrieved = await getDraft(draft.id);
    expect(retrieved).toEqual(draft);

    await deleteDraft(draft.id);
    const afterDelete = await getDraft(draft.id);
    expect(afterDelete).toBeUndefined();
  });

  it("enqueues, retrieves, and removes queued writes", async () => {
    const writeId = await enqueueWrite({
      projectRef: { store: "google-sheets", id: "sheet-123" },
      entry: {
        kind: "grade",
        optionId: "opt-1",
        value: 4,
      },
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });

    expect(typeof writeId).toBe("number");

    const queue = await getQueuedWrites();
    expect(queue.length).toBeGreaterThanOrEqual(1);
    const item = queue.find((q) => q.id === writeId);
    expect(item?.entry).toEqual({
      kind: "grade",
      optionId: "opt-1",
      value: 4,
    });

    await removeQueuedWrite(writeId);
    const afterQueue = await getQueuedWrites();
    expect(afterQueue.find((q) => q.id === writeId)).toBeUndefined();
  });

  it("caches and retrieves project snapshots for offline view", async () => {
    const projectRefId = "google-sheets:sheet-abc";
    const dummySnapshot = {
      project: {
        title: "Cached Project",
        description: "Cached description",
        protected: false,
        voting: { state: "open" as const, round: 1, topN: 3, liveResults: true },
        formatVersion: 1 as const,
      },
      options: [],
      grades: [],
      comments: [],
      rankings: [],
      outcomes: [],
      role: "owner" as const,
    };

    await saveSnapshot(projectRefId, dummySnapshot);
    const cached = await getSnapshot(projectRefId);
    expect(cached?.snapshot.project.title).toBe("Cached Project");
    expect(cached?.cachedAt).toBeDefined();
  });
});
