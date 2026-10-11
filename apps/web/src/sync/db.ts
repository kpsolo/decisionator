import type { Option } from "@decisionator/core";
import type { Entry, ProjectSnapshot } from "@decisionator/plugin-sdk";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

export interface DraftRecord {
  id: string; // ULID
  pastedText: string;
  aiAnswer?: string;
  /** Project title/description suggested by an options JSON (optional; older drafts lack them). */
  title?: string;
  description?: string;
  preview: Option[];
  warnings: string[];
  updatedAt: string; // ISO-8601
}

export interface QueuedWriteRecord {
  id?: number; // auto-incrementing key
  projectRef: { store: string; id: string };
  entry: Entry;
  queuedAt: string; // ISO-8601
  attempts: number;
}

export interface SnapshotRecord {
  projectRefId: string; // primary key: e.g. "google-sheets:12345"
  snapshot: ProjectSnapshot;
  cachedAt: string; // ISO-8601
}

export interface CachedLiveSessionRecord {
  sessionId: string;
  /** Join-link secret the guest already holds (FR-009); deleted with the record. */
  secret: string;
  /** Host verification key — from the link or pinned from the first welcome. */
  hostKey: string | null;
  participantId: string;
  displayName: string;
  name: string;
  role: "contribute" | "view";
  projectTitle: string;
  rev: number;
  snapshot: ProjectSnapshot;
  cachedAt: string;
  lastSyncedAt: string;
  lastOpenedAt: string;
}

export interface DecisionatorDB extends DBSchema {
  drafts: {
    key: string;
    value: DraftRecord;
  };
  queue: {
    key: number;
    value: QueuedWriteRecord;
    indexes: { "by-project": string };
  };
  snapshots: {
    key: string;
    value: SnapshotRecord;
  };
  live_sessions: {
    key: string;
    value: CachedLiveSessionRecord;
    indexes: { lastOpenedAt: string };
  };
}

const DB_NAME = "decisionator-store";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<DecisionatorDB>> | null = null;

export function getDatabase(): Promise<IDBPDatabase<DecisionatorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DecisionatorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("drafts")) {
          db.createObjectStore("drafts", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("queue")) {
          const queueStore = db.createObjectStore("queue", {
            keyPath: "id",
            autoIncrement: true,
          });
          queueStore.createIndex("by-project", "projectRef.id");
        }
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "projectRefId" });
        }
        if (!db.objectStoreNames.contains("live_sessions")) {
          const liveStore = db.createObjectStore("live_sessions", { keyPath: "sessionId" });
          liveStore.createIndex("lastOpenedAt", "lastOpenedAt");
        }
      },
    });
  }
  return dbPromise;
}

// Helpers for drafts
export async function saveDraft(draft: DraftRecord): Promise<void> {
  const db = await getDatabase();
  await db.put("drafts", draft);
}

export async function getDraft(id: string): Promise<DraftRecord | undefined> {
  const db = await getDatabase();
  return db.get("drafts", id);
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDatabase();
  await db.delete("drafts", id);
}

// Helpers for write queue
export async function enqueueWrite(item: Omit<QueuedWriteRecord, "id">): Promise<number> {
  const db = await getDatabase();
  return (await db.add("queue", item as QueuedWriteRecord)) as number;
}

export async function getQueuedWrites(): Promise<QueuedWriteRecord[]> {
  const db = await getDatabase();
  return db.getAll("queue");
}

export async function removeQueuedWrite(id: number): Promise<void> {
  const db = await getDatabase();
  await db.delete("queue", id);
}

// Helpers for snapshots
export async function saveSnapshot(projectRefId: string, snapshot: ProjectSnapshot): Promise<void> {
  const db = await getDatabase();
  await db.put("snapshots", {
    projectRefId,
    snapshot,
    cachedAt: new Date().toISOString(),
  });
}

export async function getSnapshot(projectRefId: string): Promise<SnapshotRecord | undefined> {
  const db = await getDatabase();
  return db.get("snapshots", projectRefId);
}

// Helpers for live sessions cache (data-model §5)
const MAX_CACHED_LIVE_SESSIONS = 30;

async function evictOldestSessions(
  db: IDBPDatabase<DecisionatorDB>,
  keepCount = MAX_CACHED_LIVE_SESSIONS
): Promise<void> {
  const all = await db.getAllFromIndex("live_sessions", "lastOpenedAt");
  if (all.length > keepCount) {
    const toRemove = all.slice(0, all.length - keepCount);
    const tx = db.transaction("live_sessions", "readwrite");
    for (const rec of toRemove) {
      await tx.store.delete(rec.sessionId);
    }
    await tx.done;
  }
}

export async function cacheLiveSession(record: CachedLiveSessionRecord): Promise<void> {
  const db = await getDatabase();
  try {
    await db.put("live_sessions", record);
    await evictOldestSessions(db);
  } catch (err: unknown) {
    if (
      (err instanceof DOMException && err.name === "QuotaExceededError") ||
      (typeof err === "object" &&
        err !== null &&
        "name" in err &&
        err.name === "QuotaExceededError")
    ) {
      const all = await db.getAllFromIndex("live_sessions", "lastOpenedAt");
      const oldest = all[0];
      if (oldest) {
        await db.delete("live_sessions", oldest.sessionId);
        await db.put("live_sessions", record);
        await evictOldestSessions(db);
        return;
      }
    }
    throw err;
  }
}

export async function getCachedLiveSession(
  sessionId: string
): Promise<CachedLiveSessionRecord | undefined> {
  const db = await getDatabase();
  return db.get("live_sessions", sessionId);
}

export async function listCachedLiveSessions(): Promise<CachedLiveSessionRecord[]> {
  const db = await getDatabase();
  const list = await db.getAllFromIndex("live_sessions", "lastOpenedAt");
  return list.reverse();
}

export async function deleteCachedLiveSession(sessionId: string): Promise<void> {
  const db = await getDatabase();
  await db.delete("live_sessions", sessionId);
}
