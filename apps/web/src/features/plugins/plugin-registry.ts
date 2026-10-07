import optionStatusManifest from "../../../../../plugins/option-status/decisionator-plugin.json";
import sourcePasteManifest from "../../../../../plugins/source-paste/decisionator-plugin.json";
import storeSheetsManifest from "../../../../../plugins/store-google-sheets/decisionator-plugin.json";
import strategyBordaManifest from "../../../../../plugins/strategy-borda/decisionator-plugin.json";
import strategyOwnerPickManifest from "../../../../../plugins/strategy-owner-pick/decisionator-plugin.json";
import strategyRandomManifest from "../../../../../plugins/strategy-random/decisionator-plugin.json";
import strategyWeightedManifest from "../../../../../plugins/strategy-weighted/decisionator-plugin.json";
import { type PluginManifest, validateManifest } from "../../host/module-host.js";

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  manifest: PluginManifest;
  source: { type: "file"; filename: string } | { type: "url"; url: string } | { type: "builtin" };
  bundleCode: string;
  enabled: boolean;
  grantedPermissions: string[];
  settings: Record<string, unknown>;
  installedAt: string;
  lastError?: string;
}

const STORAGE_KEY = "decisionator_installed_plugins";

const BUILTIN_MANIFESTS: PluginManifest[] = [
  strategyBordaManifest as unknown as PluginManifest,
  strategyRandomManifest as unknown as PluginManifest,
  strategyWeightedManifest as unknown as PluginManifest,
  strategyOwnerPickManifest as unknown as PluginManifest,
  sourcePasteManifest as unknown as PluginManifest,
  storeSheetsManifest as unknown as PluginManifest,
  optionStatusManifest as unknown as PluginManifest,
];

type Listener = (plugins: InstalledPlugin[]) => void;
const listeners = new Set<Listener>();
let devManifests: PluginManifest[] = [];

/** Calls `cb` whenever the installed plugins change, in this tab or another one. */
export function subscribePlugins(cb: Listener): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(getInstalledPlugins());
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Development only: example plugins offered like built-ins (see option-view/dev-plugins.ts). */
export function setDevPluginManifests(manifests: PluginManifest[]): void {
  devManifests = manifests;
}

function builtinRecord(m: PluginManifest, enabled = true): InstalledPlugin {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    description: (m as { description?: string }).description,
    manifest: m,
    source: { type: "builtin" },
    bundleCode: "",
    enabled,
    grantedPermissions: m.permissions ? [...m.permissions] : [],
    settings: {},
    installedAt: new Date().toISOString(),
  };
}

/**
 * Adds built-ins a stored registry does not know yet and refreshes the manifests of the ones it
 * does, keeping the person's enabled flag and settings.
 */
function withBuiltins(stored: InstalledPlugin[]): { plugins: InstalledPlugin[]; changed: boolean } {
  let changed = false;
  const plugins = [...stored];
  for (const m of [...BUILTIN_MANIFESTS, ...devManifests]) {
    const index = plugins.findIndex((p) => p.id === m.id);
    if (index < 0) {
      // Development examples are only offered when listed in deci.devPlugins, and start enabled.
      plugins.push(builtinRecord(m, true));
      changed = true;
    } else {
      const existing = plugins[index] as InstalledPlugin;
      if (
        existing.source.type === "builtin" &&
        JSON.stringify(existing.manifest) !== JSON.stringify(m)
      ) {
        plugins[index] = { ...existing, manifest: m, version: m.version, name: m.name };
        changed = true;
      }
    }
  }
  return { plugins, changed };
}

export function getInstalledPlugins(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const { plugins, changed } = withBuiltins(raw ? (JSON.parse(raw) as InstalledPlugin[]) : []);
    if (changed || !raw) localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
    return plugins;
  } catch {
    return [];
  }
}

export function saveInstalledPlugins(plugins: InstalledPlugin[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
  for (const cb of listeners) cb(plugins);
}

export function installPlugin(
  manifestInput: unknown,
  source: { type: "file"; filename: string } | { type: "url"; url: string },
  grantedPermissions: string[],
  bundleCode = ""
): InstalledPlugin {
  const validated = validateManifest(manifestInput);

  const existing = getInstalledPlugins();
  const index = existing.findIndex((p) => p.id === validated.id);

  const pluginRecord: InstalledPlugin = {
    id: validated.id,
    name: validated.name,
    version: validated.version,
    description: (validated as { description?: string }).description,
    author: (validated as { author?: string }).author,
    homepage: (validated as { homepage?: string }).homepage,
    license: (validated as { license?: string }).license,
    manifest: validated,
    source,
    bundleCode,
    enabled: true,
    grantedPermissions,
    settings: {},
    installedAt: new Date().toISOString(),
  };

  if (index >= 0) {
    existing[index] = pluginRecord;
  } else {
    existing.push(pluginRecord);
  }

  saveInstalledPlugins(existing);
  return pluginRecord;
}

export function updatePlugin(
  id: string,
  patch: Partial<Pick<InstalledPlugin, "enabled" | "grantedPermissions" | "settings" | "lastError">>
): InstalledPlugin | undefined {
  const existing = getInstalledPlugins();
  const plugin = existing.find((p) => p.id === id);
  if (!plugin) return undefined;

  Object.assign(plugin, patch);
  saveInstalledPlugins(existing);
  return plugin;
}

export function uninstallPlugin(id: string): boolean {
  const existing = getInstalledPlugins();
  const filtered = existing.filter((p) => p.id !== id);
  if (filtered.length !== existing.length) {
    saveInstalledPlugins(filtered);
    return true;
  }
  return false;
}
