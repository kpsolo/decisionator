import type { OutcomeRecord } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { closeVotingWithOutcome, rollbackGrade, withGrade } from "./project-actions.js";

const ref = { store: "memory", id: "p1" };
const outcome = { id: "o1" } as unknown as OutcomeRecord;
const voting = { state: "open" as const, round: 2, topN: 3, liveResults: false };

function fakeStore(appendFails: boolean, rollbackFails = false) {
  const calls: string[] = [];
  let metaCalls = 0;
  return {
    calls,
    updateMeta: vi.fn(async (_ref: unknown, patch: { voting?: { state: string } }) => {
      metaCalls++;
      if (rollbackFails && metaCalls > 1) throw new Error("meta down");
      calls.push(`meta:${patch.voting?.state}`);
    }),
    append: vi.fn(async () => {
      if (appendFails) throw new Error("quota");
      calls.push("append:outcome");
      return {} as never;
    }),
  };
}

describe("closeVotingWithOutcome", () => {
  it("closes voting, then records the outcome", async () => {
    const store = fakeStore(false);
    await closeVotingWithOutcome(store, ref, voting, outcome);
    expect(store.calls).toEqual(["meta:closed", "append:outcome"]);
    expect(store.updateMeta).toHaveBeenCalledWith(ref, { voting: { ...voting, state: "closed" } });
  });

  it("reopens voting with the previous settings when the outcome cannot be saved", async () => {
    const store = fakeStore(true);
    await expect(closeVotingWithOutcome(store, ref, voting, outcome)).rejects.toThrow(
      /outcome was not saved: quota.*still open/
    );
    expect(store.calls).toEqual(["meta:closed", "meta:open"]);
    expect(store.updateMeta).toHaveBeenLastCalledWith(ref, { voting });
  });

  it("says so when reopening also fails", async () => {
    const store = fakeStore(true, true);
    await expect(closeVotingWithOutcome(store, ref, voting, outcome)).rejects.toThrow(
      /could not be reopened \(meta down\)/
    );
  });

  it("does not record an outcome when closing fails", async () => {
    const store = fakeStore(false);
    store.updateMeta.mockRejectedValueOnce(new Error("offline"));
    await expect(closeVotingWithOutcome(store, ref, undefined, outcome)).rejects.toThrow("offline");
    expect(store.append).not.toHaveBeenCalled();
  });
});

describe("optimistic grades", () => {
  const g = (id: string, by: string, optionId: string, value: 1 | 2 | 3 | 4 | 5) => ({
    id,
    at: "2026-01-01T00:00:00.000Z",
    by,
    optionId,
    value,
  });
  const base = {
    grades: [g("a", "me", "o1", 2), g("b", "you", "o1", 5)],
  } as unknown as ProjectSnapshot;

  it("withGrade replaces only the viewer's grade for the option", () => {
    const next = withGrade(base, "me", "o1", g("c", "me", "o1", 4));
    expect(next.grades.map((x) => x.id).sort()).toEqual(["b", "c"]);
  });

  it("rollbackGrade restores the replaced grade", () => {
    const optimistic = g("c", "me", "o1", 4);
    const next = withGrade(base, "me", "o1", optimistic);
    const rolled = rollbackGrade(next, optimistic, base.grades[0]);
    expect(rolled.grades.find((x) => x.by === "me")?.value).toBe(2);
  });

  it("rollbackGrade removes a first grade", () => {
    const optimistic = g("c", "me", "o2", 4);
    const next = withGrade(base, "me", "o2", optimistic);
    expect(rollbackGrade(next, optimistic, undefined).grades).toHaveLength(2);
  });

  it("rollbackGrade leaves a newer grade in place", () => {
    const first = g("c", "me", "o1", 4);
    const second = g("d", "me", "o1", 5);
    const next = withGrade(withGrade(base, "me", "o1", first), "me", "o1", second);
    expect(rollbackGrade(next, first, base.grades[0])).toBe(next);
  });
});
