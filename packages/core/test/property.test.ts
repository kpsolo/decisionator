import { describe, expect, it } from "vitest";
import {
  type OptionPropertyDefinition,
  OptionPropertyDefinitionSchema,
  type PropertyValue,
  checkPropertyValue,
  effectivePropertyValues,
} from "../src/model/property.js";

function def(patch: Partial<OptionPropertyDefinition>): OptionPropertyDefinition {
  return OptionPropertyDefinitionSchema.parse({
    key: "cost",
    label: "Cost per person",
    type: "number",
    scope: "shared",
    ...patch,
  });
}

describe("option property definitions", () => {
  it("accepts a well-formed declaration with defaults", () => {
    expect(def({})).toMatchObject({ cardBadge: false, hidden: false });
  });

  it.each([
    ["key starting with a digit", { key: "1cost" }],
    ["key with upper case", { key: "Cost" }],
    ["key over 40 characters", { key: `a${"b".repeat(40)}` }],
    ["empty label", { label: " " }],
    ["label over 40 characters", { label: "x".repeat(41) }],
    ["choice without choices", { type: "choice" }],
    ["choices on a number", { choices: [{ value: "a", label: "A" }] }],
    [
      "more than 20 choices",
      {
        type: "choice",
        choices: Array.from({ length: 21 }, (_, i) => ({ value: `c${i}`, label: `C${i}` })),
      },
    ],
    [
      "duplicate choice values",
      {
        type: "choice",
        choices: [
          { value: "a", label: "A" },
          { value: "a", label: "B" },
        ],
      },
    ],
    ["a default of the wrong type", { default: "cheap" }],
  ])("refuses a %s", (_name, patch) => {
    expect(
      OptionPropertyDefinitionSchema.safeParse({
        key: "cost",
        label: "Cost per person",
        type: "number",
        scope: "shared",
        ...patch,
      }).success
    ).toBe(false);
  });
});

describe("checkPropertyValue", () => {
  it("always accepts null, which clears a value", () => {
    for (const type of ["text", "number", "boolean", "date"] as const) {
      expect(checkPropertyValue(def({ type }), null)).toEqual({ ok: true });
    }
  });

  it("checks text length 1 to 500", () => {
    const text = def({ type: "text", label: "Note" });
    expect(checkPropertyValue(text, "ok").ok).toBe(true);
    expect(checkPropertyValue(text, "")).toEqual({
      ok: false,
      message: "Note: enter text of 1 to 500 characters",
    });
    expect(checkPropertyValue(text, "x".repeat(501)).ok).toBe(false);
  });

  it("checks finite numbers and names the property", () => {
    const cost = def({});
    expect(checkPropertyValue(cost, 420).ok).toBe(true);
    expect(checkPropertyValue(cost, "abc")).toEqual({
      ok: false,
      message: "Cost per person: enter a number",
    });
    expect(checkPropertyValue(cost, Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("checks booleans, choices and calendar dates", () => {
    expect(checkPropertyValue(def({ type: "boolean" }), true).ok).toBe(true);
    expect(checkPropertyValue(def({ type: "boolean" }), "yes").ok).toBe(false);
    const level = def({
      type: "choice",
      label: "Priority",
      choices: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    });
    expect(checkPropertyValue(level, "high").ok).toBe(true);
    expect(checkPropertyValue(level, "mid")).toEqual({
      ok: false,
      message: "Priority: choose one of Low, High",
    });
    const date = def({ type: "date", label: "Deadline" });
    expect(checkPropertyValue(date, "2026-10-07").ok).toBe(true);
    expect(checkPropertyValue(date, "2026-02-30").ok).toBe(false);
    expect(checkPropertyValue(date, "07.10.2026").ok).toBe(false);
  });
});

describe("effectivePropertyValues", () => {
  const v = (patch: Partial<PropertyValue>): PropertyValue => ({
    id: Math.random().toString(36),
    at: "2026-10-07T10:00:00.000Z",
    by: "owner",
    optionId: "lis",
    plugin: "org.example.cost",
    key: "cost",
    scope: "shared",
    value: 1,
    ...patch,
  });

  it("keeps the newest shared value per option, whoever wrote it", () => {
    const out = effectivePropertyValues([
      v({ value: 1 }),
      v({ value: 2, by: "agent", at: "2026-10-07T11:00:00.000Z" }),
      v({ value: 3, optionId: "bcn" }),
    ]);
    expect(out.map((x) => [x.optionId, x.value]).sort()).toEqual([
      ["bcn", 3],
      ["lis", 2],
    ]);
  });

  it("keeps one person value per author and keeps a clear", () => {
    const person = {
      plugin: "org.decisionator.option-status",
      key: "seen",
      scope: "person" as const,
    };
    const out = effectivePropertyValues([
      v({ ...person, by: "gina", value: "seen_auto" }),
      v({ ...person, by: "tom", value: "seen" }),
      v({ ...person, by: "gina", value: null, at: "2026-10-07T12:00:00.000Z" }),
    ]);
    expect(out.map((x) => [x.by, x.value]).sort()).toEqual([
      ["gina", null],
      ["tom", "seen"],
    ]);
  });
});
