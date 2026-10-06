import type { Option } from "@decisionator/core";
import type { Entry, ProjectSnapshot } from "@decisionator/plugin-sdk";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

export interface DraftRecord {
  id: string; // ULID
  pastedText: string;
  aiAnswer?: string;
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
}

const DB_NAME = "decisionator-store";
const DB_VERSION = 1;

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
