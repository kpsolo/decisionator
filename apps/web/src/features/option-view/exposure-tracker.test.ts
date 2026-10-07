import { describe, expect, it } from "vitest";
import { ExposureTracker } from "./exposure-tracker.js";

const VIEWPORT = 800;

describe("ExposureTracker", () => {
  it("reports an option only after 5 s on screen without a break", () => {
    const t = new ExposureTracker(5000);
    t.observe("lisbon", 1, 200, VIEWPORT, 0);
    expect(t.tick(4999)).toEqual([]);
    expect(t.tick(5000)).toEqual(["lisbon"]);
  });

  it("starts over when the option leaves the screen", () => {
    const t = new ExposureTracker(5000);
    t.observe("alps", 1, 200, VIEWPORT, 0);
    t.observe("alps", 0, 0, VIEWPORT, 4000);
    expect(t.tick(4500)).toEqual([]);
    t.observe("alps", 0.8, 160, VIEWPORT, 6000);
    expect(t.tick(10_999)).toEqual([]);
    expect(t.tick(11_000)).toEqual(["alps"]);
  });

  it("does not count time while the page is hidden", () => {
    const t = new ExposureTracker(5000);
    t.observe("bcn", 1, 200, VIEWPORT, 0);
    t.setPageVisible(false, 3000);
    expect(t.tick(60_000)).toEqual([]);
    t.setPageVisible(true, 60_000);
    expect(t.tick(61_999)).toEqual([]);
    expect(t.tick(62_000)).toEqual(["bcn"]);
  });

  it("does not start counting an option that appears while the page is hidden", () => {
    const t = new ExposureTracker(1000);
    t.setPageVisible(false, 0);
    t.observe("bcn", 1, 200, VIEWPORT, 0);
    expect(t.tick(5000)).toEqual([]);
    t.setPageVisible(true, 5000);
    expect(t.tick(6000)).toEqual(["bcn"]);
  });

  it("counts a card taller than the screen once it fills half of it", () => {
    const t = new ExposureTracker(1000);
    t.observe("tall", 0.4, 400, VIEWPORT, 0);
    expect(t.tick(1000)).toEqual(["tall"]);
    const u = new ExposureTracker(1000);
    u.observe("short", 0.4, 80, VIEWPORT, 0);
    expect(u.tick(5000)).toEqual([]);
  });

  it("reports several options together, each only once", () => {
    const t = new ExposureTracker(1000);
    t.observe("a", 1, 100, VIEWPORT, 0);
    t.observe("b", 1, 100, VIEWPORT, 0);
    expect(t.tick(1000).sort()).toEqual(["a", "b"]);
    expect(t.tick(9000)).toEqual([]);
    t.observe("a", 0, 0, VIEWPORT, 9000);
    t.observe("a", 1, 100, VIEWPORT, 9100);
    expect(t.tick(20_000)).toEqual([]);
    expect(t.pending).toBe(false);
  });

  it("applies a new threshold to running timers", () => {
    const t = new ExposureTracker(10_000);
    t.observe("a", 1, 100, VIEWPORT, 0);
    expect(t.tick(7000)).toEqual([]);
    t.setMinMs(5000);
    expect(t.tick(7000)).toEqual(["a"]);
  });
});
