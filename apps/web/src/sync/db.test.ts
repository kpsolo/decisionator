import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  type CachedLiveSessionRecord,
  type DraftRecord,
  cacheLiveSession,
  deleteCachedLiveSession,
  deleteDraft,
  enqueueWrite,
  getCachedLiveSession,
  getDraft,
  getQueuedWrites,
  getSnapshot,
  listCachedLiveSessions,
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

  it("caches, retrieves, lists, and deletes live session records", async () => {
    const dummySession: CachedLiveSessionRecord = {
      sessionId: "sess-abc-123",
      secret: "secret-abc-456",
      hostKey: "host-key-hex-789",
      participantId: "peer:0123456789",
      displayName: "Alice",
      name: "Alice",
      role: "contribute",
      projectTitle: "Architecture Deliberation",
      rev: 1,
      snapshot: {
        project: {
          title: "Architecture Deliberation",
          description: "Test description",
          protected: false,
          voting: { state: "open", round: 1, topN: 3, liveResults: true },
          formatVersion: 1,
        },
        options: [],
        grades: [],
        comments: [],
        rankings: [],
        outcomes: [],
        role: "owner",
      },
      cachedAt: new Date(1_000_000).toISOString(),
      lastSyncedAt: new Date(1_000_000).toISOString(),
      lastOpenedAt: new Date(1_000_000).toISOString(),
    };

    await cacheLiveSession(dummySession);
    const retrieved = await getCachedLiveSession("sess-abc-123");
    expect(retrieved?.projectTitle).toBe("Architecture Deliberation");
    expect(retrieved?.secret).toBe("secret-abc-456");

    const list = await listCachedLiveSessions();
    expect(list.some((s) => s.sessionId === "sess-abc-123")).toBe(true);

    await deleteCachedLiveSession("sess-abc-123");
    const afterDelete = await getCachedLiveSession("sess-abc-123");
    expect(afterDelete).toBeUndefined();
  });

  it("trusts a cached host key only when it came from the join link", async () => {
    const base = {
      secret: "s",
      participantId: "peer:1",
      displayName: "Bob",
      name: "Bob",
      role: "contribute" as const,
      projectTitle: "T",
      rev: 1,
      snapshot: {
        project: {
          title: "T",
          description: "",
          protected: false,
          voting: { state: "open" as const, round: 1, topN: 3, liveResults: true },
          formatVersion: 1 as const,
        },
        options: [],
        grades: [],
        comments: [],
        rankings: [],
        outcomes: [],
        role: "view" as const,
      },
      cachedAt: new Date(2_000_000).toISOString(),
      lastSyncedAt: new Date(2_000_000).toISOString(),
      lastOpenedAt: new Date(2_000_000).toISOString(),
    };
    await cacheLiveSession({ ...base, sessionId: "pinned", hostKey: "attacker-key" });
    await cacheLiveSession({
      ...base,
      sessionId: "linked",
      hostKey: "link-key",
      hostKeyFromLink: true,
    });

    expect((await getCachedLiveSession("pinned"))?.hostKey).toBeNull();
    expect((await getCachedLiveSession("linked"))?.hostKey).toBe("link-key");
    const list = await listCachedLiveSessions();
    expect(list.find((s) => s.sessionId === "pinned")?.hostKey).toBeNull();

    await deleteCachedLiveSession("pinned");
    await deleteCachedLiveSession("linked");
  });

  it("enforces LRU eviction keeping 30 most recently opened sessions", async () => {
    // Insert 35 sessions with sequential lastOpenedAt
    for (let i = 1; i <= 35; i++) {
      const id = `session-${String(i).padStart(3, "0")}`;
      const session: CachedLiveSessionRecord = {
        sessionId: id,
        secret: `secret-${i}`,
        hostKey: null,
        participantId: `peer:${i}`,
        displayName: `User ${i}`,
        name: `User ${i}`,
        role: "contribute",
        projectTitle: `Project ${i}`,
        rev: 1,
        snapshot: {
          project: {
            title: `Project ${i}`,
            description: `Description ${i}`,
            protected: false,
            voting: { state: "open", round: 1, topN: 3, liveResults: true },
            formatVersion: 1,
          },
          options: [],
          grades: [],
          comments: [],
          rankings: [],
          outcomes: [],
          role: "owner",
        },
        cachedAt: new Date(1_000_000 + i * 1000).toISOString(),
        lastSyncedAt: new Date(1_000_000 + i * 1000).toISOString(),
        lastOpenedAt: new Date(1_000_000 + i * 1000).toISOString(),
      };
      await cacheLiveSession(session);
    }

    const cached = await listCachedLiveSessions();
    expect(cached.length).toBe(30);

    // Oldest 5 (session-001 through session-005) should have been evicted
    expect(await getCachedLiveSession("session-001")).toBeUndefined();
    expect(await getCachedLiveSession("session-005")).toBeUndefined();

    // Newest 30 (session-006 through session-035) should remain
    expect(await getCachedLiveSession("session-006")).toBeDefined();
    expect(await getCachedLiveSession("session-035")).toBeDefined();
  });
});
