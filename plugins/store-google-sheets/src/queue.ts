import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { QuotaBudget } from "./budget.js";
import {
  BadRequestError,
  type GoogleApiClient,
  ProjectUnavailableError,
  RateLimitedError,
} from "./google-api.js";

export interface QueuedWriteItem {
  id?: number;
  spreadsheetId: string;
  tab: string; // "grades" | "comments" | "rankings" | "outcomes" | …
  row: string[];
  queuedAt: string;
  /**
   * Set when Google refused the rows for good (403, 404, 400): the item is parked, no longer
   * sent or counted as queued, and kept so the app can report it or retry it (`retryFailed`).
   */
  failed?: { reason: string; at: string };
}

export interface WriteQueueDB extends DBSchema {
  writes: {
    key: number;
    value: QueuedWriteItem;
    indexes: { "by-spreadsheet": string };
  };
}

/** Rows of one spreadsheet tab that Google refused for good during a flush. */
export interface FailedWriteGroup {
  spreadsheetId: string;
  tab: string;
  count: number;
  reason: string;
  error: unknown;
}

export interface FlushResult {
  /** Rows still waiting to be sent (parked rows not included). */
  queued: number;
  sent: number;
  /** Groups parked by this flush; absent when none failed. */
  failed?: FailedWriteGroup[];
}

/** 403 (not rate limiting), 404 and 400 do not go away by retrying. */
function isPermanent(err: unknown): boolean {
  return err instanceof ProjectUnavailableError || err instanceof BadRequestError;
}

function columnLetter(count: number): string {
  let n = Math.max(1, count);
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function lockManager(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return typeof nav?.locks?.request === "function" ? nav.locks : undefined;
}

export class WriteQueue {
  private dbPromise: Promise<IDBPDatabase<WriteQueueDB>> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Flushes of this instance run one after another. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Client of the last flush, used by the retry timer after a back-off. */
  private lastClient: GoogleApiClient | null = null;

  constructor(
    private dbName = "decisionator-google-sheets-queue",
    private flushIntervalMs = 2000,
    /** Back-off state (429 / 5xx); the app may share it to show "syncing paused". */
    readonly budget: QuotaBudget = new QuotaBudget()
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

  private async getItems(spreadsheetId?: string): Promise<QueuedWriteItem[]> {
    const db = await this.getDB();
    return spreadsheetId
      ? db.getAllFromIndex("writes", "by-spreadsheet", spreadsheetId)
      : db.getAll("writes");
  }

  /** Rows waiting to be sent. Parked rows (see `getFailed`) are not counted. */
  async getQueuedCount(spreadsheetId?: string): Promise<number> {
    return (await this.getAllQueued(spreadsheetId)).length;
  }

  /** Rows waiting to be sent. Parked rows (see `getFailed`) are not included. */
  async getAllQueued(spreadsheetId?: string): Promise<QueuedWriteItem[]> {
    return (await this.getItems(spreadsheetId)).filter((item) => !item.failed);
  }

  /** Rows Google refused for good; they are kept until retried or the app discards them. */
  async getFailed(spreadsheetId?: string): Promise<QueuedWriteItem[]> {
    return (await this.getItems(spreadsheetId)).filter((item) => item.failed);
  }

  /** Puts parked rows back in the queue, e.g. after the user regained access. */
  async retryFailed(spreadsheetId?: string): Promise<number> {
    const failed = await this.getFailed(spreadsheetId);
    const db = await this.getDB();
    const tx = db.transaction("writes", "readwrite");
    for (const { failed: _failed, ...item } of failed) {
      await tx.store.put(item);
    }
    await tx.done;
    return failed.length;
  }

  /** Drops parked rows for good. */
  async discardFailed(spreadsheetId?: string): Promise<number> {
    const failed = await this.getFailed(spreadsheetId);
    const db = await this.getDB();
    const tx = db.transaction("writes", "readwrite");
    for (const item of failed) {
      if (item.id !== undefined) await tx.store.delete(item.id);
    }
    await tx.done;
    return failed.length;
  }

  /**
   * Flushes queued writes to Google Sheets: one `values.append` per (spreadsheet, tab).
   *
   * - A group Google refuses for good (403, 404, 400) is parked and reported in `failed`; the
   *   other groups are still sent.
   * - On 429 or another transient error the queue backs off (truncated exponential, see
   *   `QuotaBudget`) and retries by itself, without waiting for another append.
   * - Flushes are serialized in this instance and, with the Web Locks API, across tabs sharing
   *   the IndexedDB queue, so a row is not sent twice.
   */
  flush(apiClient: GoogleApiClient): Promise<FlushResult> {
    this.lastClient = apiClient;
    const run = () => this.withCrossTabLock(() => this.flushOnce(apiClient));
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = lockManager();
    return locks ? locks.request(`${this.dbName}:flush`, fn) : fn();
  }

  private async flushOnce(apiClient: GoogleApiClient): Promise<FlushResult> {
    if (this.budget.isPaused()) {
      this.scheduleRetry(this.budget.getPausedUntil() - Date.now());
      return { queued: await this.getQueuedCount(), sent: 0 };
    }

    // Read inside the lock: another tab may have sent and removed rows meanwhile.
    const pending = await this.getAllQueued();
    if (pending.length === 0) {
      return { queued: 0, sent: 0 };
    }

    const groups = new Map<
      string,
      { spreadsheetId: string; tab: string; items: QueuedWriteItem[] }
    >();
    for (const item of pending) {
      const key = `${item.spreadsheetId}:${item.tab}`;
      let group = groups.get(key);
      if (!group) {
        group = { spreadsheetId: item.spreadsheetId, tab: item.tab, items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
    }

    const db = await this.getDB();
    let sent = 0;
    const failed: FailedWriteGroup[] = [];
    let backOffMs: number | undefined;

    for (const group of groups.values()) {
      const rows = group.items.map((i) => i.row);
      const width = Math.max(...rows.map((r) => r.length));
      try {
        await apiClient.appendValues(
          group.spreadsheetId,
          `${group.tab}!A:${columnLetter(width)}`,
          rows
        );
      } catch (err) {
        if (isPermanent(err)) {
          const reason = err instanceof Error ? err.message : String(err);
          const at = new Date().toISOString();
          const tx = db.transaction("writes", "readwrite");
          for (const item of group.items) {
            await tx.store.put({ ...item, failed: { reason, at } });
          }
          await tx.done;
          failed.push({
            spreadsheetId: group.spreadsheetId,
            tab: group.tab,
            count: rows.length,
            reason,
            error: err,
          });
          continue;
        }
        // Rate limited, server error or offline: back off and try everything again later.
        const now = Date.now();
        const until = this.budget.handleRateLimit(now);
        const retryAfterMs =
          err instanceof RateLimitedError && err.retryAfterSeconds
            ? err.retryAfterSeconds * 1000
            : 0;
        backOffMs = Math.max(until - now, retryAfterMs);
        break;
      }
      sent += rows.length;
      const tx = db.transaction("writes", "readwrite");
      for (const item of group.items) {
        if (item.id !== undefined) await tx.store.delete(item.id);
      }
      await tx.done;
    }

    if (backOffMs === undefined) {
      this.budget.resetBackoff();
    } else {
      this.scheduleRetry(backOffMs);
    }

    const queued = await this.getQueuedCount();
    return { queued, sent, ...(failed.length > 0 ? { failed } : {}) };
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        const client = this.lastClient;
        if (client) this.flush(client).catch(() => undefined);
      },
      Math.max(0, delayMs)
    );
    // Never keep a Node process (tests, tooling) alive just for a retry.
    (this.retryTimer as { unref?: () => void }).unref?.();
  }

  /** Stops the retry and periodic timers of this instance. Queued rows stay in IndexedDB. */
  dispose(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
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
