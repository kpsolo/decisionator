import type { PropertyValue } from "@decisionator/core";
import { describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../plugins/plugin-registry.js";
import {
  type ActivePlugin,
  activePlugins,
  checkReset,
  checkWrite,
  filterMatches,
  markerPluginId,
  viewerValues,
} from "./extensions.js";

function installed(id: string, provides: Record<string, unknown>, enabled = true): InstalledPlugin {
  return {
    id,
    name: id,
    version: "0.1.0",
    manifest: {
      manifestVersion: 1,
      id,
      name: id,
      version: "0.1.0",
      platform: { runtime: "^1.0.0" },
      main: "x",
      provides,
    } as never,
    source: { type: "builtin" },
    bundleCode: "",
    enabled,
    grantedPermissions: [],
    settings: {},
    installedAt: "t",
  };
}

const costPlugin: InstalledPlugin = installed("org.example.cost", {
  optionProperties: [
    { key: "cost", label: "Cost per person", type: "number", scope: "shared" },
    { key: "shortlisted", label: "Shortlisted", type: "boolean", scope: "person" },
  ],
});

function active(p: InstalledPlugin): ActivePlugin {
  const [a] = activePlugins([p], () => undefined);
  if (!a) throw new Error("not active");
  return a;
}

describe("option-view host helpers", () => {
  it("only enabled plugins that use the option view take part", () => {
    const list = activePlugins(
      [
        costPlugin,
        installed(
          "org.example.off",
          { optionProperties: costPlugin.manifest.provides?.optionProperties },
          false
        ),
        installed("org.example.strategy", { strategy: {} }),
      ],
      () => undefined
    );
    expect(list.map((p) => p.id)).toEqual(["org.example.cost"]);
  });

  it("uses the viewer's marker choice when it is still enabled, otherwise the first", () => {
    const a = active(
      installed("a", {
        optionView: { places: ["marker"], replaces: ["marker"] },
        optionProperties: [{ key: "x", label: "X", type: "text", scope: "person" }],
      })
    );
    const b = active(
      installed("b", {
        optionView: { places: ["marker"], replaces: ["marker"] },
        optionProperties: [{ key: "x", label: "X", type: "text", scope: "person" }],
      })
    );
    expect(markerPluginId([a, b], null)).toBe("a");
    expect(markerPluginId([a, b], "b")).toBe("b");
    expect(markerPluginId([a, b], "gone")).toBe("a");
  });

  it("never shows other people's person values (FR-006)", () => {
    const v = (by: string, scope: "shared" | "person", key: string): PropertyValue => ({
      id: `${by}${key}`,
      at: "2026-01-01T00:00:00.000Z",
      by,
      optionId: "lis",
      plugin: "org.example.cost",
      key,
      scope,
      value: scope === "shared" ? 420 : true,
    });
    const seen = viewerValues(
      [
        v("owner", "shared", "cost"),
        v("gina", "person", "shortlisted"),
        v("tom", "person", "shortlisted"),
      ],
      "gina"
    );
    expect(seen.map((x) => [x.by, x.key]).sort()).toEqual([
      ["gina", "shortlisted"],
      ["owner", "cost"],
    ]);
  });

  it("checks writes: own declared keys, owner-only shared values, typed values", () => {
    const p = active(costPlugin);
    expect(checkWrite(p, "lis", "cost", 420, { id: "owner", isOwner: true }).ok).toBe(true);
    expect(checkWrite(p, "lis", "cost", 420, { id: "gina", isOwner: false })).toEqual({
      ok: false,
      message: "Cost per person: only the project owner can change this.",
    });
    expect(checkWrite(p, "lis", "cost", "abc", { id: "owner", isOwner: true })).toEqual({
      ok: false,
      message: "Cost per person: enter a number",
    });
    expect(checkWrite(p, "lis", "shortlisted", true, { id: "gina", isOwner: false }).ok).toBe(true);
    expect(checkWrite(p, "lis", "other", 1, { id: "owner", isOwner: true }).ok).toBe(false);
    expect(checkWrite(p, "lis", "shortlisted", true, { id: null, isOwner: false }).ok).toBe(false);
  });

  it("builds resets: person keys for the viewer only, shared keys for the owner only", () => {
    const p = active(costPlugin);
    expect(checkReset(p, "shortlisted", { id: "gina", isOwner: false })).toEqual({
      ok: true,
      entry: {
        kind: "reset",
        scope: "participant",
        participantId: "gina",
        targets: ["properties"],
        plugin: "org.example.cost",
        key: "shortlisted",
      },
    });
    expect(checkReset(p, "cost", { id: "gina", isOwner: false }).ok).toBe(false);
    expect(checkReset(p, "cost", { id: "owner", isOwner: true })).toMatchObject({
      ok: true,
      entry: { scope: "all" },
    });
  });

  it("treats missing values as null in list filters", () => {
    const where = { key: "seen", in: [null, "not_seen"] };
    expect(filterMatches(where, undefined)).toBe(true);
    expect(filterMatches(where, { seen: "not_seen" })).toBe(true);
    expect(filterMatches(where, { seen: "seen_auto" })).toBe(false);
  });
});
