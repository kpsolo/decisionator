import {
  type OptionPropertyDefinition,
  OptionPropertyDefinitionSchema,
  type PropertyScalar,
  type PropertyValue,
  checkPropertyValue,
  effectivePropertyValues,
} from "@decisionator/core";
import type { Entry, PluginDefinition } from "@decisionator/plugin-sdk";
import type { InstalledPlugin } from "../plugins/plugin-registry.js";

/** Pure helpers behind OptionExtensionsProvider, kept free of React so they are unit-testable. */

export type PropertyEntry = Extract<Entry, { kind: "property" }>;

export interface ActivePlugin {
  id: string;
  name: string;
  definition: PluginDefinition;
  settings: Record<string, unknown>;
  properties: OptionPropertyDefinition[];
  replacesMarker: boolean;
}

export const MARKER_CHOICE_KEY = "deci.optionView.markerPlugin";

/** Settings with the defaults from the plugin's settings schema filled in. */
export function settingsWithDefaults(plugin: InstalledPlugin): Record<string, unknown> {
  const schema = (
    plugin.manifest as { settingsSchema?: { properties?: Record<string, { default?: unknown }> } }
  ).settingsSchema;
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    if (prop && "default" in prop) defaults[key] = prop.default;
  }
  return { ...defaults, ...(plugin.settings ?? {}) };
}

/** Declared option properties of a manifest; invalid declarations are skipped. */
export function declaredProperties(plugin: InstalledPlugin): OptionPropertyDefinition[] {
  const raw = (plugin.manifest.provides as { optionProperties?: unknown[] } | undefined)
    ?.optionProperties;
  if (!Array.isArray(raw)) return [];
  const out: OptionPropertyDefinition[] = [];
  for (const d of raw) {
    const parsed = OptionPropertyDefinitionSchema.safeParse(d);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function replacesMarker(plugin: InstalledPlugin): boolean {
  const view = (plugin.manifest.provides as { optionView?: { replaces?: string[] } } | undefined)
    ?.optionView;
  return Array.isArray(view?.replaces) && view.replaces.includes("marker");
}

/** Enabled plugins that take part in the option view, in registry order. */
export function activePlugins(
  installed: InstalledPlugin[],
  definitionFor: (id: string) => PluginDefinition | undefined
): ActivePlugin[] {
  const out: ActivePlugin[] = [];
  for (const p of installed) {
    if (!p.enabled) continue;
    const properties = declaredProperties(p);
    const definition = definitionFor(p.id) ?? {};
    const usesView =
      properties.length > 0 ||
      typeof definition.optionView === "function" ||
      typeof definition.optionList === "function" ||
      typeof definition.onOptionExposed === "function";
    if (!usesView) continue;
    out.push({
      id: p.id,
      name: p.name,
      definition,
      settings: settingsWithDefaults(p),
      properties,
      replacesMarker: replacesMarker(p),
    });
  }
  return out;
}

/** The plugin whose marker is shown: the viewer's choice if still enabled, else the first. */
export function markerPluginId(plugins: ActivePlugin[], choice: string | null): string | null {
  const candidates = plugins.filter((p) => p.replacesMarker);
  if (choice && candidates.some((p) => p.id === choice)) return choice;
  return candidates[0]?.id ?? null;
}

/**
 * Values the viewer may see (FR-006): shared values plus the viewer's own person values, newest
 * first per slot. Other people's person values never leave this function.
 */
export function viewerValues(
  properties: readonly PropertyValue[],
  viewerId: string | null
): PropertyValue[] {
  return effectivePropertyValues(
    properties.filter((v) => v.scope === "shared" || (viewerId !== null && v.by === viewerId))
  );
}

/** pluginId → optionId → key → value, without cleared values. */
export type ValueIndex = Map<string, Map<string, Record<string, PropertyScalar>>>;

export function indexValues(values: readonly PropertyValue[]): ValueIndex {
  const index: ValueIndex = new Map();
  for (const v of values) {
    if (v.value === null) continue;
    let byOption = index.get(v.plugin);
    if (!byOption) index.set(v.plugin, (byOption = new Map()));
    const record = byOption.get(v.optionId) ?? {};
    record[v.key] = v.value;
    byOption.set(v.optionId, record);
  }
  return index;
}

export type WriteCheck = { ok: true; entry: PropertyEntry } | { ok: false; message: string };

/** FR-012 and FR-013: a plugin may write only its own declared properties, within scope rules. */
export function checkWrite(
  plugin: ActivePlugin,
  optionId: string,
  key: string,
  value: PropertyScalar,
  viewer: { id: string | null; isOwner: boolean }
): WriteCheck {
  const def = plugin.properties.find((p) => p.key === key);
  if (!def) return { ok: false, message: `${plugin.name}: unknown property '${key}'` };
  if (viewer.id === null) return { ok: false, message: "Sign in to change this." };
  if (def.scope === "shared" && !viewer.isOwner) {
    return { ok: false, message: `${def.label}: only the project owner can change this.` };
  }
  const check = checkPropertyValue(def, value);
  if (!check.ok) return check;
  return {
    ok: true,
    entry: { kind: "property", optionId, plugin: plugin.id, key, scope: def.scope, value },
  };
}

/** Whether a list filter keeps an option: missing values count as `null`. */
export function filterMatches(
  where: { key: string; in: PropertyScalar[] },
  values: Record<string, PropertyScalar> | undefined
): boolean {
  const value = values?.[where.key] ?? null;
  return where.in.some((v) => v === value);
}
