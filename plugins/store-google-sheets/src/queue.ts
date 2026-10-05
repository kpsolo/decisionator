import type { Entry } from "@decisionator/plugin-sdk";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { GoogleApiClient } from "./google-api.js";

export interface QueuedWriteItem {
  id?: number;
  spreadsheetId: string;
  tab: string; // "grades" | "comments" | "rankings" | "outcomes"
  row: string[];
  queuedAt: string;
}

export interface WriteQueueDB extends DBSchema {
  writes: {
    key: number;
    value: QueuedWriteItem;
    indexes: { "by-spreadsheet": string };
  };
}

export interface FlushResult {
  queued: number;
  sent: number;
}

export class WriteQueue {
  private dbPromise: Promise<IDBPDatabase<WriteQueueDB>> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;

  constructor(
    private dbName = "decisionator-google-sheets-queue",
    private flushIntervalMs = 2000
  ) {}

  private getDB(): Promise<IDBPDatabase<WriteQueueDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<WriteQueueDB>(this.dbName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("writes")) {
            const store = db.createObjectStore("writes", {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("by-spreadsheet", "spreadsheetId");
          }
        },
      });
    }
    return this.dbPromise;
  }

  async enqueue(spreadsheetId: string, tab: string, row: string[]): Promise<void> {
    const db = await this.getDB();
    await db.add("writes", {
      spreadsheetId,
      tab,
      row,
      queuedAt: new Date().toISOString(),
    });
  }

  async getQueuedCount(spreadsheetId?: string): Promise<number> {
    const db = await this.getDB();
    if (spreadsheetId) {
      return db.countFromIndex("writes", "by-spreadsheet", spreadsheetId);
    }
    return db.count("writes");
  }

  async getAllQueued(spreadsheetId?: string): Promise<QueuedWriteItem[]> {
    const db = await this.getDB();
    if (spreadsheetId) {
      return db.getAllFromIndex("writes", "by-spreadsheet", spreadsheetId);
    }
    return db.getAll("writes");
  }

  /**
   * Flushes queued writes to Google Sheets:
   * Groups rows by (spreadsheetId, tab) and issues one values.append per tab.
   */
  async flush(apiClient: GoogleApiClient): Promise<FlushResult> {
    if (this.isFlushing) {
      const remaining = await this.getQueuedCount();
      return { queued: remaining, sent: 0 };
    }

    this.isFlushing = true;
    try {
      const db = await this.getDB();
      const allWrites = await db.getAll("writes");

      if (allWrites.length === 0) {
        return { queued: 0, sent: 0 };
      }

      // Group by spreadsheetId and tab
      const groups = new Map<
        string,
        { spreadsheetId: string; tab: string; rows: string[][]; ids: number[] }
      >();

      for (const item of allWrites) {
        const key = `${item.spreadsheetId}:${item.tab}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            spreadsheetId: item.spreadsheetId,
            tab: item.tab,
            rows: [],
            ids: [],
          };
          groups.set(key, group);
        }
        group.rows.push(item.row);
        if (item.id !== undefined) {
          group.ids.push(item.id);
        }
      }

      let sentCount = 0;
      for (const group of groups.values()) {
        await apiClient.appendValues(group.spreadsheetId, `${group.tab}!A:E`, group.rows);
        sentCount += group.rows.length;

        // Remove flushed rows from IndexedDB
        const tx = db.transaction("writes", "readwrite");
        for (const id of group.ids) {
          await tx.store.delete(id);
        }
        await tx.done;
      }

      const remaining = await this.getQueuedCount();
      return { queued: remaining, sent: sentCount };
    } finally {
      this.isFlushing = false;
    }
  }

  startPeriodicFlush(apiClient: GoogleApiClient, onError?: (err: unknown) => void): () => void {
    const run = async () => {
      try {
        await this.flush(apiClient);
      } catch (err) {
        if (onError) onError(err);
      } finally {
        this.flushTimer = setTimeout(run, this.flushIntervalMs);
      }
    };

    this.flushTimer = setTimeout(run, this.flushIntervalMs);
    return () => {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    };
  }
}
