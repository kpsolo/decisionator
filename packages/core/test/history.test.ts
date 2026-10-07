import { describe, expect, it } from "vitest";
import type { Grade, Ranking } from "../src/model/entries.js";
import {
  type Reset,
  ResetFieldsSchema,
  effectiveEntries,
  monotonicNow,
} from "../src/model/history.js";
import type { PropertyValue } from "../src/model/property.js";

const t = (minute: number) => `2026-10-07T14:${String(minute).padStart(2, "0")}:00.000Z`;
let n = 0;
const id = () => `e${n++}`;

const grade = (by: string, optionId: string, value: number, minute: number): Grade =>
  ({ id: id(), at: t(minute), by, optionId, value }) as Grade;
const ballot = (by: string, round: number, minute: number): Ranking =>
  ({ id: id(), at: t(minute), by, round, ranking: ["lis"] }) as Ranking;
const prop = (
  by: string,
  scope: "shared" | "person",
  value: string | number,
  minute: number,
  key = scope === "person" ? "seen" : "cost"
): PropertyValue => ({
  id: id(),
  at: t(minute),
  by,
  optionId: "lis",
  plugin: scope === "person" ? "org.decisionator.option-status" : "org.example.cost",
  key,
  scope,
  value,
});
const reset = (minute: number, fields: Omit<Reset, "id" | "at" | "by">): Reset => ({
  id: id(),
  at: t(minute),
  by: "owner",
  ...fields,
});

describe("effectiveEntries", () => {
  it("keeps the latest grade per author and option and moves the rest to history", () => {
    const out = effectiveEntries({
      grades: [grade("gina", "lis", 3, 5), grade("gina", "lis", 4, 20), grade("tom", "lis", 2, 31)],
      rankings: [],
    });
    expect(out.grades.map((g) => [g.by, g.value]).sort()).toEqual([
      ["gina", 4],
      ["tom", 2],
    ]);
    expect(out.history.grades.map((g) => g.value)).toEqual([3]);
  });

  it("clears only the named participant's earlier entries", () => {
    const out = effectiveEntries({
      grades: [grade("owner", "lis", 5, 1), grade("gina", "lis", 4, 2), grade("tom", "lis", 2, 3)],
      rankings: [ballot("tom", 1, 4), ballot("gina", 1, 4)],
      resets: [
        reset(10, { scope: "participant", participantId: "tom", targets: ["grades", "ballots"] }),
      ],
    });
    expect(out.grades.map((g) => g.by).sort()).toEqual(["gina", "owner"]);
    expect(out.rankings.map((r) => r.by)).toEqual(["gina"]);
    expect(out.history.grades.map((g) => g.by)).toEqual(["tom"]);
    expect(out.history.rankings.map((r) => r.by)).toEqual(["tom"]);
    expect(out.history.resets).toHaveLength(1);
  });

  it("never clears entries added after the reset", () => {
    const out = effectiveEntries({
      grades: [grade("tom", "lis", 2, 3), grade("tom", "bcn", 5, 12)],
      rankings: [],
      resets: [reset(10, { scope: "participant", participantId: "tom", targets: ["grades"] })],
    });
    expect(out.grades.map((g) => g.optionId)).toEqual(["bcn"]);
  });

  it("limits a ballot reset to its round and leaves grades of other targets alone", () => {
    const out = effectiveEntries({
      grades: [grade("gina", "lis", 4, 1)],
      rankings: [ballot("gina", 1, 2), ballot("gina", 2, 3)],
      resets: [reset(10, { scope: "all", targets: ["ballots"], round: 1 })],
    });
    expect(out.rankings.map((r) => r.round)).toEqual([2]);
    expect(out.grades).toHaveLength(1);
  });

  it("clears shared values on an all reset and person values only on a participant reset", () => {
    const all = effectiveEntries({
      grades: [],
      rankings: [],
      properties: [prop("owner", "shared", 420, 1), prop("gina", "person", "seen_auto", 2)],
      resets: [reset(10, { scope: "all", targets: ["properties"] })],
    });
    expect(all.properties.map((p) => p.scope)).toEqual(["person"]);

    const own = effectiveEntries({
      grades: [],
      rankings: [],
      properties: [prop("gina", "person", "seen_auto", 2), prop("tom", "person", "seen", 3)],
      resets: [
        {
          ...reset(10, {
            scope: "participant",
            participantId: "gina",
            targets: ["properties"],
            plugin: "org.decisionator.option-status",
            key: "seen",
          }),
          by: "gina",
        },
      ],
    });
    expect(own.properties.map((p) => p.by)).toEqual(["tom"]);
  });

  it("respects plugin and key limits", () => {
    const out = effectiveEntries({
      grades: [],
      rankings: [],
      properties: [prop("owner", "shared", 420, 1), prop("owner", "shared", "x", 1, "note")],
      resets: [
        reset(10, {
          scope: "all",
          targets: ["properties"],
          plugin: "org.example.cost",
          key: "cost",
        }),
      ],
    });
    expect(out.properties.map((p) => p.key)).toEqual(["note"]);
  });
});

describe("reset validation", () => {
  it.each([
    { scope: "participant", targets: ["grades"] },
    { scope: "all", participantId: "tom", targets: ["grades"] },
    { scope: "all", targets: [] },
    { scope: "all", targets: ["grades", "grades"] },
    { scope: "all", targets: ["properties"], plugin: "x" },
    { scope: "all", targets: ["ballots"], round: 0 },
  ])("refuses %o", (fields) => {
    expect(ResetFieldsSchema.safeParse(fields).success).toBe(false);
  });
});

describe("monotonicNow", () => {
  it("never returns the same or an earlier time", () => {
    const stamps = Array.from({ length: 50 }, () => monotonicNow());
    for (let i = 1; i < stamps.length; i++) {
      expect((stamps[i] as string) > (stamps[i - 1] as string)).toBe(true);
    }
  });
});
