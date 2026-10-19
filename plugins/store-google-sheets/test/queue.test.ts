import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { QuotaBudget } from "../src/budget.js";
import {
  type GoogleApiClient,
  ProjectUnavailableError,
  RateLimitedError,
} from "../src/google-api.js";
import { WriteQueue } from "../src/queue.js";

describe("WriteQueue", () => {
  it("enqueues items into IndexedDB and groups flushes by tab", async () => {
    const queue = new WriteQueue("test-queue-1", 1000);

    await queue.enqueue("sheet-1", "grades", [
      "g1",
      "now",
      "user@example.com",
      "opt1",
      '{"value":5}',
    ]);
    await queue.enqueue("sheet-1", "grades", [
      "g2",
      "now",
      "user@example.com",
      "opt2",
      '{"value":4}',
    ]);
    await queue.enqueue("sheet-1", "comments", [
      "c1",
      "now",
      "user@example.com",
      "opt1",
      '{"body":"hello"}',
    ]);

    expect(await queue.getQueuedCount("sheet-1")).toBe(3);

    const appendValuesMock = vi.fn().mockResolvedValue({ updates: {} });
    const mockClient = {
      appendValues: appendValuesMock,
    } as unknown as GoogleApiClient;

    const result = await queue.flush(mockClient);

    expect(result.sent).toBe(3);
    expect(result.queued).toBe(0);

    // Two append calls: one for grades with 2 rows, one for comments with 1 row
    expect(appendValuesMock).toHaveBeenCalledTimes(2);
    expect(appendValuesMock).toHaveBeenCalledWith("sheet-1", "grades!A:E", [
      ["g1", "now", "user@example.com", "opt1", '{"value":5}'],
      ["g2", "now", "user@example.com", "opt2", '{"value":4}'],
    ]);
    expect(appendValuesMock).toHaveBeenCalledWith("sheet-1", "comments!A:E", [
      ["c1", "now", "user@example.com", "opt1", '{"body":"hello"}'],
    ]);

    // Queue is empty after flush
    expect(await queue.getQueuedCount()).toBe(0);
  });

  it("survives reloads by persisting across different WriteQueue instances", async () => {
    const queue1 = new WriteQueue("test-queue-reload", 1000);
    await queue1.enqueue("sheet-reload", "grades", [
      "g1",
      "now",
      "user@example.com",
      "opt1",
      '{"value":3}',
    ]);

    // New instance with same DB name
    const queue2 = new WriteQueue("test-queue-reload", 1000);
    const count = await queue2.getQueuedCount("sheet-reload");
    expect(count).toBe(1);

    const items = await queue2.getAllQueued("sheet-reload");
    expect(items[0]?.row[0]).toBe("g1");
  });

  const fastBudget = () =>
    new QuotaBudget({ maxReadsPerMinute: 20, maxWritesPerMinute: 20, maxBackoffSeconds: 0.05 });

  it("parks a spreadsheet that fails permanently and still flushes the others", async () => {
    const queue = new WriteQueue("test-queue-park", 1000, fastBudget());
    await queue.enqueue("sheet-gone", "grades", ["g1", "now", "u@example.com", "o", "{}"]);
    await queue.enqueue("sheet-ok", "grades", ["g2", "now", "u@example.com", "o", "{}"]);

    const appendValues = vi.fn(async (spreadsheetId: string) => {
      if (spreadsheetId === "sheet-gone") throw new ProjectUnavailableError("File not found");
      return { updates: {} };
    });
    const client = { appendValues } as unknown as GoogleApiClient;

    const first = await queue.flush(client);
    expect(first.sent).toBe(1);
    expect(first.queued).toBe(0);
    expect(first.failed?.map((f) => [f.spreadsheetId, f.count])).toEqual([["sheet-gone", 1]]);
    expect(await queue.getQueuedCount()).toBe(0);
    expect((await queue.getFailed("sheet-gone")).map((i) => i.row[0])).toEqual(["g1"]);

    // The parked group is not retried on every flush, so it no longer blocks other projects.
    await queue.enqueue("sheet-ok", "grades", ["g3", "now", "u@example.com", "o", "{}"]);
    const second = await queue.flush(client);
    expect(second.sent).toBe(1);
    expect(appendValues.mock.calls.filter(([id]) => id === "sheet-gone")).toHaveLength(1);
  });

  it("retries queued rows after a 429 without another append", async () => {
    const queue = new WriteQueue("test-queue-retry", 1000, fastBudget());
    await queue.enqueue("sheet-rl", "grades", ["g1", "now", "u@example.com", "o", "{}"]);

    const appendValues = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitedError())
      .mockResolvedValue({ updates: {} });
    const client = { appendValues } as unknown as GoogleApiClient;

    const first = await queue.flush(client);
    expect(first).toMatchObject({ sent: 0, queued: 1 });

    await vi.waitFor(
      async () => {
        expect(appendValues).toHaveBeenCalledTimes(2);
        expect(await queue.getQueuedCount()).toBe(0);
      },
      { timeout: 3000, interval: 20 }
    );
    queue.dispose();
  });

  it("sends each row once when two instances (tabs) flush the same queue", async () => {
    const tabA = new WriteQueue("test-queue-tabs", 1000, fastBudget());
    const tabB = new WriteQueue("test-queue-tabs", 1000, fastBudget());
    await tabA.enqueue("sheet-tabs", "grades", ["g1", "now", "u@example.com", "o", "{}"]);

    const appendValues = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { updates: {} };
    });
    const client = { appendValues } as unknown as GoogleApiClient;

    const [a, b] = await Promise.all([tabA.flush(client), tabB.flush(client)]);
    expect(appendValues).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    expect(await tabA.getQueuedCount()).toBe(0);
  });

  it("appends rows wider than five columns to a matching range", async () => {
    const queue = new WriteQueue("test-queue-width", 1000, fastBudget());
    await queue.enqueue("sheet-w", "contributions", ["k1", "now", "u", "option", "o", "{}"]);
    const appendValues = vi.fn().mockResolvedValue({ updates: {} });
    await queue.flush({ appendValues } as unknown as GoogleApiClient);
    expect(appendValues).toHaveBeenCalledWith("sheet-w", "contributions!A:F", [
      ["k1", "now", "u", "option", "o", "{}"],
    ]);
  });
});
