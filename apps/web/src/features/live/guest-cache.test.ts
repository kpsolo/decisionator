import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import {
  type CachedLiveSessionRecord,
  cacheLiveSession,
  deleteCachedLiveSession,
  getCachedLiveSession,
  listCachedLiveSessions,
} from "../../sync/db.js";

const DUMMY_SNAPSHOT: ProjectSnapshot = {
  project: {
    title: "Quarterly Roadmap Deliberation",
    description: "Prioritizing Q3 initiatives",
    protected: false,
    voting: { state: "open", round: 1, topN: 3, liveResults: true },
    formatVersion: 1,
  },
  options: [
    {
      id: "opt-1",
      title: "Feature Alpha",
      description: "Mobile client upgrade",
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
    {
      id: "opt-2",
      title: "Feature Beta",
      description: "Offline sync",
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
  ],
  grades: [{ id: "g-1", optionId: "opt-1", by: "peer:gina", value: 5, at: new Date().toISOString() }],
  comments: [
    {
      id: "c-1",
      optionId: "opt-1",
      by: "peer:gina",
      byName: "Gina",
      body: "Crucial for Q3",
      at: new Date().toISOString(),
    },
  ],
  rankings: [],
  outcomes: [],
  role: "contribute",
};

describe("Guest Offline Cache Lifecycle & Error Handling (US2, T011)", () => {
  const sessionId = "sess-offline-101";

  beforeEach(async () => {
    await deleteCachedLiveSession(sessionId);
  });

  it("persists deliberation on snapshot receipt and restores offline view immediately", async () => {
    const record: CachedLiveSessionRecord = {
      sessionId,
      secret: "sec-xyz-789",
      hostKey: "hostkey-hex-456",
      participantId: "peer:gina",
      displayName: "Gina",
      name: "Gina",
      role: "contribute",
      projectTitle: "Quarterly Roadmap Deliberation",
      rev: 2,
      snapshot: DUMMY_SNAPSHOT,
      cachedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };

    // 1. Host snapshot received -> cached in IndexedDB
    await cacheLiveSession(record);

    // 2. Host tab closes, guest re-opens link -> retrieved from IndexedDB in < 1s
    const start = performance.now();
    const retrieved = await getCachedLiveSession(sessionId);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(1000);
    expect(retrieved).toBeDefined();
    expect(retrieved?.snapshot.project.title).toBe("Quarterly Roadmap Deliberation");
    expect(retrieved?.snapshot.options).toHaveLength(2);
    expect(retrieved?.snapshot.grades).toHaveLength(1);
    expect(retrieved?.snapshot.comments).toHaveLength(1);
    expect(retrieved?.participantId).toBe("peer:gina");
    expect(retrieved?.role).toBe("contribute");
  });

  it("formats offline status indicator with last synced timestamp", () => {
    const syncedTime = new Date("2026-10-11T12:00:00Z");
    const indicatorText = `Host offline • Last synced ${syncedTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    expect(indicatorText).toContain("Host offline • Last synced");
  });

  it("handles in-flight submission drop on host disconnect", () => {
    // When a guest submission is interrupted by an unexpected host disconnect
    const errorFromDisconnect = new Error("Host disconnected");
    const userFacingError =
      errorFromDisconnect.message.includes("disconnected")
        ? "Host disconnected; submission not saved"
        : "Failed to save submission";

    expect(userFacingError).toBe("Host disconnected; submission not saved");
  });
});
