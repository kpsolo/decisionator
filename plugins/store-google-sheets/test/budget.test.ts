import { describe, expect, it, vi } from "vitest";
import { QuotaBudget } from "../src/budget.js";

describe("QuotaBudget and Back-off", () => {
  it("enforces max 20 reads and 20 writes per minute", () => {
    const budget = new QuotaBudget({
      maxReadsPerMinute: 20,
      maxWritesPerMinute: 20,
      maxBackoffSeconds: 64,
    });

    const startTime = 1_000_000;
    for (let i = 0; i < 20; i++) {
      expect(budget.canRead(startTime)).toBe(true);
      budget.recordRead(startTime);
    }
    // 21st read in the same minute is blocked
    expect(budget.canRead(startTime)).toBe(false);

    // After 61 seconds, read is allowed again
    expect(budget.canRead(startTime + 61_000)).toBe(true);
  });

  it("calculates truncated exponential backoff with jitter, capped at 64s", () => {
    const budget = new QuotaBudget();
    const now = 10_000_000;

    // attempt 1: 2^1 = 2s + 0.5s jitter = 2.5s
    const paused1 = budget.handleRateLimit(now, 0.5);
    expect(paused1).toBe(now + 2500);
    expect(budget.isPaused(now + 1000)).toBe(true);
    expect(budget.isPaused(now + 2600)).toBe(false);

    // attempt 2: 2^2 = 4s + 0.2s jitter = 4.2s
    const paused2 = budget.handleRateLimit(now, 0.2);
    expect(paused2).toBe(now + 4200);

    // High attempt capped at 64s
    for (let i = 0; i < 10; i++) {
      budget.handleRateLimit(now, 0.5);
    }
    const capped = budget.handleRateLimit(now, 0.5);
    expect(capped).toBeLessThanOrEqual(now + 64_000);
  });

  it("emits pausedUntil events on rate limit", () => {
    const budget = new QuotaBudget();
    const listener = vi.fn();
    budget.on("pausedUntil", listener);

    const now = 20_000_000;
    budget.handleRateLimit(now, 0.1);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        pausedUntil: expect.any(Number),
      })
    );
  });
});
