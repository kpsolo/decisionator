import type { PluginDefinition } from "@decisionator/plugin-sdk";
import { type PluginManifest, validateManifest } from "../../host/module-host.js";
import { setDevPluginManifests } from "../plugins/plugin-registry.js";
import { registerOptionViewDefinition } from "./builtins.js";

/**
 * Development only (feature 005, T038): offers the example option plugins, and two fixtures for
 * the end-to-end tests, as plugins on the Plugins page. Nothing happens unless the app runs in
 * development mode and localStorage `deci.devPlugins` lists the plugin ids, for example
 * `["org.decisionator.examples.option-cost","org.decisionator.examples.unread-bar"]`.
 * `main.tsx` calls `installDevPlugins()` behind `import.meta.env.DEV`, so production builds drop
 * this module and the examples.
 */
export const DEV_PLUGINS_KEY = "deci.devPlugins";

const fixturePlatform = { runtime: "^1.0.0", optionProperties: "^1.0.0", optionView: "^1.0.0" };

/** Declares `priority` too, under another plugin id (US3 scenario 5: same key, both shown). */
const priorityAltManifest = {
  manifestVersion: 1,
  id: "org.example.priority-alt",
  name: "Priority (alternative)",
  description: 'Development fixture: a second plugin that also declares a "Priority" property.',
  version: "0.1.0",
  platform: fixturePlatform,
  main: "dist/index.js",
  provides: {
    optionProperties: [
      {
        key: "priority",
        label: "Priority",
        type: "choice",
        scope: "person",
        choices: [
          { value: "now", label: "Now" },
          { value: "later", label: "Later" },
        ],
      },
    ],
  },
};

/** Its view hook always throws (US4 scenario 7: the host falls back with a notice). */
const brokenManifest = {
  manifestVersion: 1,
  id: "org.example.broken",
  name: "Broken view",
  description: "Development fixture: its option view always fails.",
  version: "0.1.0",
  platform: fixturePlatform,
  main: "dist/index.js",
  provides: { optionView: { places: ["badges", "footer"] } },
};

// Loaded through Vite globs so the type checker of the app does not pull the examples (which live
// outside apps/web) into its program; they have only type imports, so they run as they are.
const exampleSources = import.meta.glob<Record<string, unknown>>(
  "../../../../../examples/plugin-{option-cost,unread-bar}/src/index.ts",
  { eager: true }
);
const exampleManifests = import.meta.glob<{ default: unknown }>(
  "../../../../../examples/plugin-{option-cost,unread-bar}/decisionator-plugin.json",
  { eager: true }
);

function example(
  dir: string,
  factory: string
): { manifest: unknown; create: () => PluginDefinition } {
  const source = Object.entries(exampleSources).find(([path]) => path.includes(`/${dir}/`))?.[1];
  const manifest = Object.entries(exampleManifests).find(([path]) =>
    path.includes(`/${dir}/`)
  )?.[1];
  const create = source?.[factory];
  return {
    manifest: manifest?.default ?? { id: `missing:${dir}` },
    create: typeof create === "function" ? (create as () => PluginDefinition) : () => ({}),
  };
}

const DEV_PLUGINS: { manifest: unknown; create: () => PluginDefinition }[] = [
  example("plugin-option-cost", "createOptionCostPlugin"),
  example("plugin-unread-bar", "createUnreadBarPlugin"),
  { manifest: priorityAltManifest, create: () => ({}) },
  {
    manifest: brokenManifest,
    create: () => ({
      optionView() {
        throw new Error("This fixture always fails.");
      },
    }),
  },
];

/** Plugin ids listed in localStorage `deci.devPlugins`; anything unreadable counts as none. */
export function listedDevPluginIds(storage: Pick<Storage, "getItem"> | undefined): string[] {
  try {
    const raw = storage?.getItem(DEV_PLUGINS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Registers the listed development plugins with the plugin registry and the option-view host.
 * Returns the ids it registered. Call it before the first render.
 */
export function installDevPlugins(
  ids: string[] = listedDevPluginIds(typeof localStorage === "undefined" ? undefined : localStorage)
): string[] {
  const manifests: PluginManifest[] = [];
  for (const plugin of DEV_PLUGINS) {
    const id = (plugin.manifest as { id: string }).id;
    if (!ids.includes(id)) continue;
    try {
      manifests.push(validateManifest(plugin.manifest));
    } catch (err) {
      console.warn(`[dev-plugins] ${id} skipped:`, err);
      continue;
    }
    registerOptionViewDefinition(id, plugin.create);
  }
  setDevPluginManifests(manifests);
  return manifests.map((m) => m.id);
}
