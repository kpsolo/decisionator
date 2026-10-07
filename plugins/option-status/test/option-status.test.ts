import type { Option, PropertyScalar } from "@decisionator/core";
import type { ExposureContext, OptionViewContext } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import { OPTION_STATUS_PLUGIN_ID, createOptionStatusPlugin, statusTitle } from "../src/index.js";

function option(id: string, status: Option["status"] = "active"): Option {
  return {
    id,
    title: `Option ${id}`,
    description: "",
    status,
    tags: [],
    pros: [],
    cons: [],
    links: [],
  };
}

function viewCtx(
  seen: PropertyScalar | undefined,
  writes: [string, PropertyScalar][] = [],
  surface: "card" | "detail" = "detail"
) {
  const ctx: OptionViewContext = {
    option: option("lis"),
    viewerId: "gina",
    surface,
    values: seen === undefined ? {} : { seen },
    valueMeta: seen === undefined ? {} : { seen: { at: "2026-10-07T12:03:00.000Z", by: "gina" } },
    settings: {},
    setValue: async (key, value) => {
      writes.push([key, value]);
    },
  };
  return ctx;
}

function exposureCtx(
  valuesByOption: Record<string, Record<string, PropertyScalar>>,
  writes: { optionId: string; key: string; value: PropertyScalar }[][]
): ExposureContext {
  return {
    viewerId: "gina",
    settings: {},
    valuesByOption,
    setValues: async (changes) => {
      writes.push(changes);
    },
  };
}

describe("option status plugin", () => {
  it("has the built-in id", () => {
    expect(OPTION_STATUS_PLUGIN_ID).toBe("org.decisionator.option-status");
  });

  it("shows the unseen marker and 'Mark as seen' only for new options", async () => {
    const plugin = createOptionStatusPlugin();
    for (const value of [undefined, null, "not_seen"] as const) {
      const view = await plugin.optionView?.(viewCtx(value));
      expect(view?.marker).toEqual({
        variant: "dot",
        label: "Not seen",
        tone: "primary",
        replace: true,
      });
      expect(view?.footer).toMatchObject([{ action: { id: "mark-seen", label: "Mark as seen" } }]);
    }
    for (const value of ["seen", "seen_auto"] as const) {
      const view = await plugin.optionView?.(viewCtx(value));
      expect(view?.marker).toBeNull();
      expect(view?.footer).toMatchObject([
        { action: { id: "mark-not-seen", label: "Mark as not seen" } },
      ]);
    }
  });

  it("keeps cards to the marker only", async () => {
    const plugin = createOptionStatusPlugin();
    const view = await plugin.optionView?.(viewCtx(undefined, [], "card"));
    expect(view?.marker?.variant).toBe("dot");
    expect(view?.footer).toEqual([]);
  });

  it("marks exposed new options as seen_auto in one batch", async () => {
    const plugin = createOptionStatusPlugin();
    const writes: { optionId: string; key: string; value: PropertyScalar }[][] = [];
    await plugin.onOptionExposed?.(
      exposureCtx({ b: { seen: "seen" }, c: { seen: "not_seen" } }, writes),
      ["a", "b", "c"]
    );
    expect(writes).toEqual([
      [
        { optionId: "a", key: "seen", value: "seen_auto" },
        { optionId: "c", key: "seen", value: "seen_auto" },
      ],
    ]);
  });

  it("does not re-mark an option marked 'not seen' by hand until the next visit", async () => {
    const plugin = createOptionStatusPlugin();
    const writes: [string, PropertyScalar][] = [];
    const ctx = viewCtx("seen_auto", writes);
    await plugin.onOptionAction?.(ctx, "mark-not-seen");
    expect(writes).toEqual([["seen", "not_seen"]]);

    const batches: { optionId: string; key: string; value: PropertyScalar }[][] = [];
    await plugin.onOptionExposed?.(exposureCtx({ lis: { seen: "not_seen" } }, batches), ["lis"]);
    expect(batches).toEqual([]);

    // A new page visit is a new plugin instance.
    const later = createOptionStatusPlugin();
    await later.onOptionExposed?.(exposureCtx({ lis: { seen: "not_seen" } }, batches), ["lis"]);
    expect(batches).toEqual([[{ optionId: "lis", key: "seen", value: "seen_auto" }]]);
  });

  it("'Mark as seen' records a manual mark and lifts the 'not seen' hold", async () => {
    const plugin = createOptionStatusPlugin();
    const writes: [string, PropertyScalar][] = [];
    await plugin.onOptionAction?.(viewCtx("seen", writes), "mark-not-seen");
    await plugin.onOptionAction?.(viewCtx("not_seen", writes), "mark-seen");
    expect(writes).toEqual([
      ["seen", "not_seen"],
      ["seen", "seen"],
    ]);
  });

  it("counts new active options and offers the 'Only not seen' filter", async () => {
    const plugin = createOptionStatusPlugin();
    const list = await plugin.optionList?.({
      options: [option("a"), option("b"), option("c")],
      viewerId: "gina",
      valuesByOption: { a: { seen: "seen_auto" }, b: { seen: "not_seen" } },
      settings: {},
      resetValues: async () => {},
    });
    expect(list?.summary).toEqual({ text: "2 not seen yet" });
    expect(list?.filters).toEqual([
      { id: "unseen", label: "Only not seen", where: { key: "seen", in: [null, "not_seen"] } },
    ]);

    const none = await plugin.optionList?.({
      options: [option("a")],
      viewerId: "gina",
      valuesByOption: { a: { seen: "seen" } },
      settings: {},
      resetValues: async () => {},
    });
    expect(none?.summary).toBeUndefined();
  });

  it("uses the configured seconds and turns exposure off with autoMark", () => {
    const plugin = createOptionStatusPlugin();
    expect(plugin.exposureMs?.({})).toBe(5000);
    expect(plugin.exposureMs?.({ seconds: 10 })).toBe(10_000);
    expect(plugin.exposureMs?.({ autoMark: false, seconds: 10 })).toBeNull();
    // Out-of-range or malformed values fall back to the default.
    expect(plugin.exposureMs?.({ seconds: 0 })).toBe(5000);
    expect(plugin.exposureMs?.({ seconds: 301 })).toBe(5000);
    expect(plugin.exposureMs?.({ seconds: "7" })).toBe(5000);
  });

  it("titles the status action with how and when the mark was set", async () => {
    const plugin = createOptionStatusPlugin();
    const auto = await plugin.optionView?.(viewCtx("seen_auto"));
    const action = auto?.footer?.[0];
    expect(action && "action" in action && action.action.title).toMatch(/^Seen automatically · /);
    expect(statusTitle("seen", "2026-10-07T12:03:00.000Z")).toMatch(/^Marked as seen · /);
    expect(statusTitle("not_seen", "2026-10-07T12:03:00.000Z")).toMatch(/^Marked as not seen · /);
    expect(statusTitle(undefined, undefined)).toBeUndefined();
  });

  it("'Mark all as not seen' resets the viewer's marks and holds every option as new", async () => {
    const plugin = createOptionStatusPlugin();
    const list = await plugin.optionList?.({
      options: [option("a")],
      viewerId: "gina",
      valuesByOption: {},
      settings: {},
      resetValues: async () => {},
    });
    expect(list?.actions).toEqual([
      {
        id: "reset-seen",
        label: "Mark all as not seen",
        confirm: "Show every option as new again? Only your own marks change.",
      },
    ]);
    const resets: string[] = [];
    await plugin.onListAction?.(
      {
        options: [option("a"), option("b")],
        viewerId: "gina",
        valuesByOption: {},
        settings: {},
        resetValues: async (key) => void resets.push(key),
      },
      "reset-seen"
    );
    expect(resets).toEqual(["seen"]);
    const batches: { optionId: string; key: string; value: PropertyScalar }[][] = [];
    await plugin.onOptionExposed?.(exposureCtx({}, batches), ["a", "b"]);
    expect(batches).toEqual([]);
  });
});
