import { beforeEach, describe, expect, it } from "vitest";
import {
  type InstalledPlugin,
  getInstalledPlugins,
  subscribePlugins,
  updatePlugin,
} from "./plugin-registry.js";

const STORAGE_KEY = "decisionator_installed_plugins";

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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
});

describe("plugin registry", () => {
  it("seeds every built-in, including the option status plugin, enabled", () => {
    const plugins = getInstalledPlugins();
    const status = plugins.find((p) => p.id === "org.decisionator.option-status");
    expect(status?.enabled).toBe(true);
    expect(status?.source).toEqual({ type: "builtin" });
  });

  it("adds a new built-in to an existing registry and keeps the person's choices", () => {
    const stored = getInstalledPlugins()
      .filter((p) => p.id !== "org.decisionator.option-status")
      .map((p) =>
        p.id === "org.decisionator.strategy.borda"
          ? { ...p, enabled: false, settings: { topN: 5 } }
          : p
      );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const plugins = getInstalledPlugins();
    expect(plugins.some((p) => p.id === "org.decisionator.option-status")).toBe(true);
    const borda = plugins.find((p) => p.id === "org.decisionator.strategy.borda");
    expect(borda).toMatchObject({ enabled: false, settings: { topN: 5 } });
  });

  it("refreshes a stored built-in manifest but keeps enabled and settings", () => {
    const stored = getInstalledPlugins().map((p) =>
      p.id === "org.decisionator.option-status"
        ? {
            ...p,
            enabled: false,
            settings: { seconds: 9 },
            manifest: { ...p.manifest, version: "0.0.1" },
          }
        : p
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const status = getInstalledPlugins().find((p) => p.id === "org.decisionator.option-status");
    expect(status?.manifest.version).toBe("0.1.0");
    expect(status).toMatchObject({ enabled: false, settings: { seconds: 9 } });
  });

  it("notifies subscribers when a plugin changes", () => {
    getInstalledPlugins();
    const seen: InstalledPlugin[][] = [];
    const off = subscribePlugins((p) => seen.push(p));
    updatePlugin("org.decisionator.option-status", { enabled: false });
    off();
    updatePlugin("org.decisionator.option-status", { enabled: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.find((p) => p.id === "org.decisionator.option-status")?.enabled).toBe(false);
  });
});
