import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatcher } from "./batcher.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createBatcher", () => {
  it("sends the first batch at once and later ones no more than every 2 s", async () => {
    const sent: number[][] = [];
    const b = createBatcher<number>(async (items) => void sent.push(items), {
      now: () => Date.now(),
    });
    const first = b.add([1, 2]);
    b.kick();
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(sent).toEqual([[1, 2]]);

    const second = b.add([3]);
    b.kick();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(sent).toEqual([[1, 2], [3]]);
  });

  it("splits more than 50 items over several sends", async () => {
    const sizes: number[] = [];
    const b = createBatcher<number>(async (items) => void sizes.push(items.length));
    const all = b.add(Array.from({ length: 120 }, (_, i) => i));
    b.kick();
    await vi.advanceTimersByTimeAsync(5000);
    await all;
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("rejects the items of a failed send", async () => {
    const b = createBatcher<number>(async () => {
      throw new Error("rate_limited");
    });
    const p = b.add([1]);
    b.kick();
    const check = expect(p).rejects.toThrow("rate_limited");
    await vi.advanceTimersByTimeAsync(0);
    await check;
  });
});
