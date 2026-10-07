import { beforeEach, describe, expect, it } from "vitest";
import { getInstalledPlugins, setDevPluginManifests } from "../plugins/plugin-registry.js";
import { optionViewDefinition } from "./builtins.js";
import { DEV_PLUGINS_KEY, installDevPlugins, listedDevPluginIds } from "./dev-plugins.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const ALL = [
  "org.decisionator.examples.option-cost",
  "org.decisionator.examples.unread-bar",
  "org.example.priority-alt",
  "org.example.broken",
];

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  setDevPluginManifests([]);
});

describe("dev plugins", () => {
  it("reads the listed ids and ignores anything else", () => {
    expect(listedDevPluginIds(undefined)).toEqual([]);
    localStorage.setItem(DEV_PLUGINS_KEY, "not json");
    expect(listedDevPluginIds(localStorage)).toEqual([]);
    localStorage.setItem(DEV_PLUGINS_KEY, JSON.stringify(["a", 3, "b"]));
    expect(listedDevPluginIds(localStorage)).toEqual(["a", "b"]);
  });

  it("registers nothing unless listed", () => {
    expect(installDevPlugins()).toEqual([]);
    expect(getInstalledPlugins().some((p) => ALL.includes(p.id))).toBe(false);
  });

  it("registers the listed plugins, whose manifests validate, starting disabled", () => {
    localStorage.setItem(DEV_PLUGINS_KEY, JSON.stringify(ALL));
    expect(installDevPlugins()).toEqual(ALL);
    const installed = getInstalledPlugins().filter((p) => ALL.includes(p.id));
    expect(installed.map((p) => p.id)).toEqual(ALL);
    expect(installed.every((p) => !p.enabled)).toBe(true);
  });

  it("gives the examples their view definitions and a throwing fixture", async () => {
    installDevPlugins(ALL);
    const bar = optionViewDefinition("org.decisionator.examples.unread-bar");
    expect(bar?.exposureMs?.({})).toBe(5000);
    expect(typeof optionViewDefinition("org.decisionator.examples.option-cost")?.optionView).toBe(
      "function"
    );
    const broken = optionViewDefinition("org.example.broken");
    expect(() => broken?.optionView?.({} as never)).toThrow(/always fails/);
  });

  it("declares priority in two plugins under different ids", () => {
    installDevPlugins(ALL);
    const withPriority = getInstalledPlugins().filter((p) =>
      (p.manifest.provides.optionProperties ?? []).some(
        (d) => (d as { key?: string }).key === "priority"
      )
    );
    expect(withPriority.map((p) => p.id)).toEqual([
      "org.decisionator.examples.option-cost",
      "org.example.priority-alt",
    ]);
  });
});
