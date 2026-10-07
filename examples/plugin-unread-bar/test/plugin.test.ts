import { OptionPropertyDefinitionSchema, type PropertyScalar } from "@decisionator/core";
import {
  type ExposureContext,
  type OptionViewContext,
  validateContribution,
} from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import manifest from "../decisionator-plugin.json";
import { UNREAD_BAR_PLUGIN_ID, createUnreadBarPlugin } from "../src/index.js";

function viewCtx(
  seen: PropertyScalar | undefined,
  writes: [string, PropertyScalar][] = [],
  surface: "card" | "detail" = "card"
): OptionViewContext {
  return {
    option: {
      id: "lis",
      title: "Lisbon",
      description: "",
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
    viewerId: "gina",
    surface,
    values: seen === undefined ? {} : { seen },
    settings: {},
    setValue: async (key, value) => {
      writes.push([key, value]);
    },
  };
}

const BAR = { variant: "bar", label: "Not seen", tone: "info", replace: true };

describe("unread bar example plugin", () => {
  it("declares its own person property, exposure and the marker replacement", () => {
    expect(manifest.id).toBe(UNREAD_BAR_PLUGIN_ID);
    const [seen] = manifest.provides.optionProperties.map((d) =>
      OptionPropertyDefinitionSchema.parse(d)
    );
    expect(seen).toMatchObject({ key: "seen", type: "choice", scope: "person", hidden: true });
    expect(seen?.choices?.map((c) => c.value)).toEqual(["seen", "not_seen"]);
    expect(manifest.provides.exposure).toBe(true);
    expect(manifest.provides.optionView.replaces).toEqual(["marker"]);
  });

  it("waits 1000 x seconds, 5 s by default", () => {
    const plugin = createUnreadBarPlugin();
    expect(plugin.exposureMs?.({})).toBe(5000);
    expect(plugin.exposureMs?.({ seconds: 12 })).toBe(12_000);
    expect(plugin.exposureMs?.({ seconds: 0 })).toBe(5000);
  });

  it("shows the blue bar for unseen options and nothing once seen", async () => {
    const plugin = createUnreadBarPlugin();
    for (const value of [undefined, null, "not_seen"] as const) {
      const view = await plugin.optionView?.(viewCtx(value));
      expect(view?.marker).toEqual(BAR);
      expect(validateContribution(view, "card").droppedPlaces).toEqual([]);
    }
    const seen = await plugin.optionView?.(viewCtx("seen"));
    expect(seen?.marker).toBeNull();
  });

  it("offers the manual actions in the detail view only", async () => {
    const plugin = createUnreadBarPlugin();
    expect((await plugin.optionView?.(viewCtx(undefined)))?.footer).toEqual([]);
    expect((await plugin.optionView?.(viewCtx(undefined, [], "detail")))?.footer).toEqual([
      { action: { id: "mark-seen", label: "Mark as seen" } },
    ]);
    expect((await plugin.optionView?.(viewCtx("seen", [], "detail")))?.footer).toEqual([
      { action: { id: "mark-not-seen", label: "Mark as not seen" } },
    ]);
  });

  it("writes its own property from the actions", async () => {
    const plugin = createUnreadBarPlugin();
    const writes: [string, PropertyScalar][] = [];
    await plugin.onOptionAction?.(viewCtx(undefined, writes, "detail"), "mark-seen");
    await plugin.onOptionAction?.(viewCtx("seen", writes, "detail"), "mark-not-seen");
    expect(writes).toEqual([
      ["seen", "seen"],
      ["seen", "not_seen"],
    ]);
  });

  it("marks exposed options seen, but not ones marked by hand", async () => {
    const plugin = createUnreadBarPlugin();
    const writes: { optionId: string; key: string; value: PropertyScalar }[][] = [];
    const ctx: ExposureContext = {
      viewerId: "gina",
      settings: {},
      valuesByOption: { b: { seen: "not_seen" }, c: { seen: "seen" } },
      setValues: async (changes) => {
        writes.push(changes);
      },
    };
    await plugin.onOptionExposed?.(ctx, ["a", "b", "c"]);
    expect(writes).toEqual([[{ optionId: "a", key: "seen", value: "seen" }]]);
    await plugin.onOptionExposed?.(ctx, ["b", "c"]);
    expect(writes).toHaveLength(1);
  });
});
