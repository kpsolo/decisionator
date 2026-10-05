import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { GoogleApiClient } from "../src/google-api.js";
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
});
