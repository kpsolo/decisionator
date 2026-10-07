import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { getInstalledPlugins, updatePlugin } from "../plugins/plugin-registry.js";
import { OptionSettings, SECONDS_ERROR, parseSeconds } from "./OptionSettings.js";

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

describe("Settings → Options", () => {
  it("accepts whole seconds from 1 to 300 only", () => {
    expect(parseSeconds("5")).toBe(5);
    expect(parseSeconds("300")).toBe(300);
    expect(parseSeconds("0")).toBeNull();
    expect(parseSeconds("400")).toBeNull();
    expect(parseSeconds("2.5")).toBeNull();
    expect(parseSeconds("abc")).toBeNull();
    expect(SECONDS_ERROR).toBe("The time must be between 1 and 300 seconds.");
  });

  it("shows automatic marking on and 5 seconds by default", () => {
    getInstalledPlugins();
    const html = renderToStaticMarkup(<OptionSettings />);
    expect(html).toContain("Mark options as seen automatically");
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain('value="5"');
    expect(html).not.toContain("Marker style");
  });

  it("is hidden when the Option status plugin is disabled", () => {
    getInstalledPlugins();
    updatePlugin("org.decisionator.option-status", { enabled: false });
    expect(renderToStaticMarkup(<OptionSettings />)).toBe("");
  });
});
