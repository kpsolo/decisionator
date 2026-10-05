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
];

export function getInstalledPlugins(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Initialize with built-ins
      const initial: InstalledPlugin[] = BUILTIN_MANIFESTS.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        description: (m as { description?: string }).description,
        manifest: m,
        source: { type: "builtin" },
        bundleCode: "",
        enabled: true,
        grantedPermissions: m.permissions ? [...m.permissions] : [],
        settings: {},
        installedAt: new Date().toISOString(),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw) as InstalledPlugin[];
  } catch {
    return [];
  }
}

export function saveInstalledPlugins(plugins: InstalledPlugin[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
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
