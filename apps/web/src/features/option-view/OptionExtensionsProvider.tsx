import type {
  Option,
  OptionPropertyDefinition,
  PropertyScalar,
  PropertyValue,
  Reset,
} from "@decisionator/core";
import { monotonicNow } from "@decisionator/core";
import {
  type OptionListAction,
  type OptionListFilter,
  type OptionViewContext,
  type OptionViewContribution,
  validateContribution,
  validateListContribution,
} from "@decisionator/plugin-sdk";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "../../components/ui/use-toast.js";
import { getInstalledPlugins, subscribePlugins } from "../plugins/plugin-registry.js";
import { optionViewDefinition } from "./builtins.js";
import {
  type ActivePlugin,
  type ExtensionEntry,
  MARKER_CHOICE_KEY,
  type MetaIndex,
  type PropertyEntry,
  type ValueIndex,
  activePlugins,
  checkReset,
  checkWrite,
  filterMatches,
  indexMeta,
  indexValues,
  markerPluginId,
  sharedPropertyDefs,
  viewerValues,
} from "./extensions.js";
import { useExposure } from "./useExposure.js";

export interface ResolvedOptionView {
  marker: (NonNullable<OptionViewContribution["marker"]> & { plugin: string }) | null;
  badges: (NonNullable<OptionViewContribution["badges"]>[number] & { plugin: string })[];
  footer: (NonNullable<OptionViewContribution["footer"]>[number] & { plugin: string })[];
  sections: (NonNullable<OptionViewContribution["sections"]>[number] & { plugin: string })[];
  /** Plugins whose contribution (or part of it) failed: the host shows a notice. */
  failed: string[];
}

export interface PropertyRow {
  plugin: ActivePlugin;
  def: OptionPropertyDefinition;
  value: PropertyScalar | undefined;
  editable: boolean;
  /** Label with the plugin name when another plugin uses the same key. */
  label: string;
}

/** Current values, readable without re-rendering every consumer when one option changes. */
interface ValueStore {
  values(): ValueIndex;
  meta(): MetaIndex;
  subscribe(cb: () => void): () => void;
  /** Changes when any value of this option (for any plugin) changes. */
  signature(optionId: string): string;
}

interface Ctx {
  plugins: ActivePlugin[];
  store: ValueStore;
  viewerId: string | null;
  isOwner: boolean;
  markerPlugin: string | null;
  setValue(pluginId: string, optionId: string, key: string, value: PropertyScalar): Promise<void>;
  runAction(pluginId: string, option: Option, actionId: string): Promise<void>;
  resetValues(pluginId: string, key: string): Promise<void>;
  runListAction(pluginId: string, actionId: string, options: Option[]): Promise<void>;
  /** Appends reset entries chosen by the owner (Reset dialog). */
  appendResets(entries: ResetEntry[]): Promise<void>;
  sharedDefs: ReturnType<typeof sharedPropertyDefs>;
  exposureRef(optionId: string): (el: Element | null) => void;
}

const EMPTY_VIEW: ResolvedOptionView = {
  marker: null,
  badges: [],
  footer: [],
  sections: [],
  failed: [],
};
const OptionExtensionsContext = createContext<Ctx | null>(null);
type ResetEntry = Extract<ExtensionEntry, { kind: "reset" }>;

function readMarkerChoice(): string | null {
  try {
    return localStorage.getItem(MARKER_CHOICE_KEY);
  } catch {
    return null;
  }
}

export interface OptionExtensionsProviderProps {
  /** Participant id of the viewer, or null when unknown (nothing is recorded or shown). */
  viewerId: string | null;
  isOwner: boolean;
  options: Option[];
  properties: PropertyValue[] | undefined;
  /** Records property and reset entries for the viewer; rejects to roll optimistic state back. */
  appendProperties(entries: ExtensionEntry[]): Promise<void>;
  children: React.ReactNode;
}

/**
 * Hosts the option-properties and option-view extension points for one page (contracts
 * `option-properties` and `option-view` 1.0.0). Plugin instances live as long as the page, which
 * is what "page visit" means for exposure and the status plugin's manual hold.
 */
export function OptionExtensionsProvider({
  viewerId,
  isOwner,
  options,
  properties,
  appendProperties,
  children,
}: OptionExtensionsProviderProps) {
  const [installed, setInstalled] = useState(getInstalledPlugins);
  const [markerChoice, setMarkerChoice] = useState(readMarkerChoice);
  useEffect(
    () =>
      subscribePlugins((p) => {
        setInstalled(p);
        setMarkerChoice(readMarkerChoice());
      }),
    []
  );
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MARKER_CHOICE_KEY) setMarkerChoice(readMarkerChoice());
    };
    window.addEventListener("storage", onStorage);
    const onLocal = () => setMarkerChoice(readMarkerChoice());
    window.addEventListener("deci:marker-choice", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("deci:marker-choice", onLocal);
    };
  }, []);

  // One definition instance per plugin for the life of this page.
  const instances = useRef(new Map<string, ReturnType<typeof optionViewDefinition>>());
  const plugins = useMemo(
    () =>
      activePlugins(installed, (id) => {
        if (!instances.current.has(id)) instances.current.set(id, optionViewDefinition(id));
        return instances.current.get(id);
      }),
    [installed]
  );

  // Optimistic values: shown at once, superseded by the store's stamped entries.
  const [local, setLocal] = useState<PropertyValue[]>([]);
  const [localResets, setLocalResets] = useState<Reset[]>([]);
  const all = useMemo(() => [...(properties ?? []), ...local], [properties, local]);
  const visible = useMemo(
    () => viewerValues(all, viewerId, localResets),
    [all, viewerId, localResets]
  );
  const values = useMemo(() => indexValues(visible), [visible]);
  const meta = useMemo(() => indexMeta(visible), [visible]);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  // A stable store over the latest values; consumers subscribe per option.
  const listeners = useRef(new Set<() => void>());
  const signatures = useRef(new Map<string, string>());
  const valueStore = useMemo<ValueStore>(
    () => ({
      values: () => valuesRef.current,
      meta: () => metaRef.current,
      subscribe: (cb) => {
        listeners.current.add(cb);
        return () => listeners.current.delete(cb);
      },
      signature: (optionId) => {
        const cached = signatures.current.get(optionId);
        if (cached !== undefined) return cached;
        const parts: unknown[] = [];
        for (const [pluginId, byOption] of valuesRef.current) {
          const v = byOption.get(optionId);
          const m = metaRef.current.get(pluginId)?.get(optionId);
          if (v || m) parts.push(pluginId, v, m);
        }
        const sig = JSON.stringify(parts);
        signatures.current.set(optionId, sig);
        return sig;
      },
    }),
    []
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: notify on every values change
  useEffect(() => {
    signatures.current.clear();
    for (const cb of listeners.current) cb();
  }, [values, meta]);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const write = useCallback(
    async (
      pluginId: string,
      changes: { optionId: string; key: string; value: PropertyScalar }[]
    ) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin || changes.length === 0) return;
      const entries: PropertyEntry[] = [];
      for (const c of changes) {
        const check = checkWrite(plugin, c.optionId, c.key, c.value, { id: viewerId, isOwner });
        if (!check.ok) throw new Error(check.message);
        entries.push(check.entry);
      }
      const optimistic: PropertyValue[] = entries.map((e, i) => ({
        id: `local:${i}:${Math.random().toString(36).slice(2, 10)}`,
        at: monotonicNow(),
        by: viewerId ?? "",
        optionId: e.optionId,
        plugin: e.plugin,
        key: e.key,
        scope: e.scope,
        value: e.value,
      }));
      setLocal((l) => [...l, ...optimistic]);
      try {
        await appendProperties(entries);
      } catch (err) {
        const ids = new Set(optimistic.map((o) => o.id));
        setLocal((l) => l.filter((v) => !ids.has(v.id)));
        throw err;
      }
    },
    [plugins, viewerId, isOwner, appendProperties]
  );

  const setValue = useCallback(
    (pluginId: string, optionId: string, key: string, value: PropertyScalar) =>
      write(pluginId, [{ optionId, key, value }]),
    [write]
  );

  const viewContext = useCallback(
    (plugin: ActivePlugin, option: Option, surface: "card" | "detail"): OptionViewContext => ({
      option,
      viewerId: viewerId ?? "",
      surface,
      values: valuesRef.current.get(plugin.id)?.get(option.id) ?? {},
      valueMeta: metaRef.current.get(plugin.id)?.get(option.id) ?? {},
      settings: plugin.settings,
      setValue: (key, value) => setValue(plugin.id, option.id, key, value),
    }),
    [viewerId, setValue]
  );

  // Resets show at once (FR-034) and roll back when the store refuses them.
  const appendResets = useCallback(
    async (entries: ResetEntry[]) => {
      if (entries.length === 0) return;
      const optimistic: Reset[] = entries.map((e, i) => {
        const { kind: _kind, ...fields } = e;
        return {
          id: `local-reset:${i}:${Math.random().toString(36).slice(2, 10)}`,
          at: monotonicNow(),
          by: viewerId ?? "",
          ...fields,
        } as Reset;
      });
      setLocalResets((r) => [...r, ...optimistic]);
      try {
        await appendProperties(entries);
      } catch (err) {
        const ids = new Set(optimistic.map((o) => o.id));
        setLocalResets((r) => r.filter((x) => !ids.has(x.id)));
        throw err;
      }
    },
    [viewerId, appendProperties]
  );

  const resetValues = useCallback(
    async (pluginId: string, key: string) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin) return;
      const check = checkReset(plugin, key, { id: viewerId, isOwner });
      if (!check.ok) throw new Error(check.message);
      await appendResets([check.entry]);
    },
    [plugins, viewerId, isOwner, appendResets]
  );

  const runListAction = useCallback(
    async (pluginId: string, actionId: string, listOptions: Option[]) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin?.definition.onListAction) return;
      try {
        await plugin.definition.onListAction(
          {
            options: listOptions,
            viewerId: viewerId ?? "",
            valuesByOption: Object.fromEntries(valuesRef.current.get(plugin.id) ?? []),
            settings: plugin.settings,
            resetValues: (key) => resetValues(plugin.id, key),
          },
          actionId
        );
      } catch (err) {
        toast({
          title: plugin.name,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    },
    [plugins, viewerId, resetValues]
  );
  const sharedDefs = useMemo(() => sharedPropertyDefs(plugins), [plugins]);

  const runAction = useCallback(
    async (pluginId: string, option: Option, actionId: string) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin?.definition.onOptionAction) return;
      try {
        await plugin.definition.onOptionAction(viewContext(plugin, option, "detail"), actionId);
      } catch (err) {
        toast({
          title: plugin.name,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    },
    [plugins, viewContext]
  );

  // Exposure: one tracker per plugin threshold, fed by a shared observer.
  const exposurePlugins = useMemo(
    () =>
      viewerId === null
        ? []
        : plugins.flatMap((p) => {
            const ms = p.definition.onOptionExposed ? p.definition.exposureMs?.(p.settings) : null;
            return typeof ms === "number" && ms > 0 ? [{ plugin: p, ms }] : [];
          }),
    [plugins, viewerId]
  );
  const activeIds = useMemo(
    () => new Set(options.filter((o) => o.status === "active").map((o) => o.id)),
    [options]
  );
  const onExposed = useCallback(
    async (pluginId: string, optionIds: string[]) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      const ids = optionIds.filter((id) => activeIds.has(id));
      if (!plugin?.definition.onOptionExposed || ids.length === 0) return;
      const byOption = valuesRef.current.get(plugin.id);
      try {
        await plugin.definition.onOptionExposed(
          {
            viewerId: viewerId ?? "",
            settings: plugin.settings,
            valuesByOption: Object.fromEntries(byOption ?? []),
            setValues: (changes) => write(plugin.id, changes),
          },
          ids
        );
      } catch {
        // Marks are best effort; the next visit tries again.
      }
    },
    [plugins, viewerId, activeIds, write]
  );
  const exposureRef = useExposure(
    useMemo(() => exposurePlugins.map((e) => ({ id: e.plugin.id, ms: e.ms })), [exposurePlugins]),
    onExposed
  );

  const value = useMemo<Ctx>(
    () => ({
      plugins,
      store: valueStore,
      viewerId,
      isOwner,
      markerPlugin: markerPluginId(plugins, markerChoice),
      setValue,
      runAction,
      resetValues,
      runListAction,
      appendResets,
      sharedDefs,
      exposureRef,
    }),
    [
      plugins,
      valueStore,
      viewerId,
      isOwner,
      markerChoice,
      setValue,
      runAction,
      resetValues,
      runListAction,
      appendResets,
      sharedDefs,
      exposureRef,
    ]
  );

  return (
    <OptionExtensionsContext.Provider value={value}>{children}</OptionExtensionsContext.Provider>
  );
}

function useCtx(): Ctx | null {
  return useContext(OptionExtensionsContext);
}

/** Registers an element showing `optionId` for exposure tracking; a no-op outside a provider. */
export function useExposureRef(optionId: string): (el: Element | null) => void {
  // Depends on the stable exposureRef only: a new ref callback would detach the element and
  // restart its timer every time any value changes.
  const exposureRef = useCtx()?.exposureRef;
  return useMemo(() => (exposureRef ? exposureRef(optionId) : () => {}), [exposureRef, optionId]);
}

function resolve(
  ctx: Ctx,
  option: Option,
  surface: "card" | "detail",
  results: Map<string, unknown>
): ResolvedOptionView {
  const view: ResolvedOptionView = {
    marker: null,
    badges: [],
    footer: [],
    sections: [],
    failed: [],
  };
  for (const plugin of ctx.plugins) {
    if (!plugin.definition.optionView) continue;
    if (!results.has(plugin.id)) continue;
    const raw = results.get(plugin.id);
    if (raw instanceof Error) {
      view.failed.push(plugin.id);
      continue;
    }
    const { value: c, droppedPlaces } = validateContribution(raw, surface);
    if (droppedPlaces.length > 0) view.failed.push(plugin.id);
    if (c.marker && plugin.id === ctx.markerPlugin)
      view.marker = { ...c.marker, plugin: plugin.id };
    for (const b of c.badges ?? []) view.badges.push({ ...b, plugin: plugin.id });
    for (const f of c.footer ?? []) view.footer.push({ ...f, plugin: plugin.id });
    for (const s of c.sections ?? []) view.sections.push({ ...s, plugin: plugin.id });
  }
  // Declared properties with cardBadge show as "label: value" badges.
  const byKey = new Map<string, number>();
  for (const p of ctx.plugins)
    for (const d of p.properties) byKey.set(d.key, (byKey.get(d.key) ?? 0) + 1);
  for (const plugin of ctx.plugins) {
    for (const def of plugin.properties) {
      if (!def.cardBadge || def.hidden) continue;
      const v = ctx.store.values().get(plugin.id)?.get(option.id)?.[def.key];
      if (v === undefined || v === null) continue;
      view.badges.push({
        text: `${def.label}: ${displayValue(def, v)}`.slice(0, 40),
        plugin: plugin.id,
        tone: "neutral",
      });
    }
  }
  return view;
}

export function displayValue(def: OptionPropertyDefinition, v: PropertyScalar): string {
  if (v === null) return "";
  if (def.type === "boolean") return v ? "Yes" : "No";
  if (def.type === "choice") return def.choices?.find((c) => c.value === v)?.label ?? String(v);
  return String(v);
}

/** What plugins contribute to one option on a card or in the detail view. */
function useOptionSignature(ctx: Ctx | null, optionId: string): string {
  return useSyncExternalStore(
    ctx ? ctx.store.subscribe : noopSubscribe,
    () => (ctx ? ctx.store.signature(optionId) : ""),
    () => ""
  );
}

const noopSubscribe = () => () => {};

export function useOptionView(option: Option, surface: "card" | "detail"): ResolvedOptionView {
  const ctx = useCtx();
  const signature = useOptionSignature(ctx, option.id);
  const [asyncResults, setAsyncResults] = useState<Map<string, unknown>>(new Map());

  // `signature` changes exactly when this option's values change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature is the change trigger
  const syncResults = useMemo(() => {
    const results = new Map<string, unknown>();
    if (!ctx) return results;
    for (const plugin of ctx.plugins) {
      const hook = plugin.definition.optionView;
      if (!hook) continue;
      try {
        const out = hook({
          option,
          viewerId: ctx.viewerId ?? "",
          surface,
          values: ctx.store.values().get(plugin.id)?.get(option.id) ?? {},
          valueMeta: ctx.store.meta().get(plugin.id)?.get(option.id) ?? {},
          settings: plugin.settings,
          setValue: (key, value) => ctx.setValue(plugin.id, option.id, key, value),
        });
        results.set(plugin.id, out);
      } catch (err) {
        results.set(plugin.id, err instanceof Error ? err : new Error(String(err)));
      }
    }
    return results;
  }, [ctx, option, surface, signature]);

  useEffect(() => {
    let cancelled = false;
    for (const [id, out] of syncResults) {
      if (out && typeof (out as Promise<unknown>).then === "function") {
        (out as Promise<unknown>).then(
          (v) => !cancelled && setAsyncResults((m) => new Map(m).set(id, v)),
          (err) =>
            !cancelled &&
            setAsyncResults((m) =>
              new Map(m).set(id, err instanceof Error ? err : new Error(String(err)))
            )
        );
      }
    }
    return () => {
      cancelled = true;
    };
  }, [syncResults]);

  return useMemo(() => {
    if (!ctx) return EMPTY_VIEW;
    const merged = new Map<string, unknown>();
    for (const [id, out] of syncResults) {
      const isPromise = out && typeof (out as Promise<unknown>).then === "function";
      if (!isPromise) merged.set(id, out);
      else if (asyncResults.has(id)) merged.set(id, asyncResults.get(id));
    }
    return resolve(ctx, option, surface, merged);
  }, [ctx, option, surface, syncResults, asyncResults]);
}

/** Runs one of a plugin's footer actions. */
export function useOptionAction(): (
  pluginId: string,
  option: Option,
  actionId: string
) => Promise<void> {
  const ctx = useCtx();
  return useCallback(
    async (pluginId, option, actionId) => {
      await ctx?.runAction(pluginId, option, actionId);
    },
    [ctx]
  );
}

/** The detail view's property section: declared, non-hidden properties of enabled plugins. */
export function usePropertyRows(option: Option): {
  rows: PropertyRow[];
  setValue(row: PropertyRow, value: PropertyScalar): Promise<void>;
} {
  const ctx = useCtx();
  const signature = useOptionSignature(ctx, option.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature is the change trigger
  const rows = useMemo(() => {
    if (!ctx) return [];
    const keyCount = new Map<string, number>();
    for (const p of ctx.plugins)
      for (const d of p.properties) keyCount.set(d.key, (keyCount.get(d.key) ?? 0) + 1);
    const out: PropertyRow[] = [];
    for (const plugin of ctx.plugins) {
      for (const def of plugin.properties) {
        if (def.hidden) continue;
        const editable = ctx.viewerId !== null && (def.scope === "person" || ctx.isOwner);
        out.push({
          plugin,
          def,
          value: ctx.store.values().get(plugin.id)?.get(option.id)?.[def.key],
          editable,
          label: (keyCount.get(def.key) ?? 0) > 1 ? `${def.label} (${plugin.name})` : def.label,
        });
      }
    }
    return out;
  }, [ctx, option, signature]);
  const setValue = useCallback(
    async (row: PropertyRow, value: PropertyScalar) => {
      if (!ctx) return;
      await ctx.setValue(row.plugin.id, option.id, row.def.key, value);
    },
    [ctx, option]
  );
  return { rows, setValue };
}

export interface ResolvedOptionList {
  summaries: { plugin: string; text: string }[];
  filters: (OptionListFilter & { plugin: string })[];
  actions: (OptionListAction & { plugin: string })[];
  runAction(pluginId: string, actionId: string): Promise<void>;
  /** Whether the option passes the filter `plugin/filterId`. */
  matches(filterKey: string, optionId: string): boolean;
}

/** List summary and filters for the active options shown on a page. */
export function useOptionList(options: Option[]): ResolvedOptionList {
  const ctx = useCtx();
  const values = useSyncExternalStore(
    ctx ? ctx.store.subscribe : noopSubscribe,
    () => ctx?.store.values() ?? null,
    () => null
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: values is the change trigger
  return useMemo(() => {
    const result: ResolvedOptionList = {
      summaries: [],
      filters: [],
      actions: [],
      runAction: async (pluginId, actionId) => {
        await ctx?.runListAction(pluginId, actionId, options);
      },
      matches: () => true,
    };
    if (!ctx) return result;
    const filters = new Map<string, OptionListFilter & { plugin: string }>();
    for (const plugin of ctx.plugins) {
      const hook = plugin.definition.optionList;
      if (!hook) continue;
      const byOption = ctx.store.values().get(plugin.id);
      let raw: unknown;
      try {
        raw = hook({
          options,
          viewerId: ctx.viewerId ?? "",
          valuesByOption: Object.fromEntries(byOption ?? []),
          settings: plugin.settings,
          resetValues: (key) => ctx.resetValues(plugin.id, key),
        });
      } catch {
        continue;
      }
      if (raw && typeof (raw as Promise<unknown>).then === "function") continue;
      const { value } = validateListContribution(raw);
      if (value.summary) result.summaries.push({ plugin: plugin.id, text: value.summary.text });
      for (const a of value.actions ?? []) result.actions.push({ ...a, plugin: plugin.id });
      for (const f of value.filters ?? []) {
        result.filters.push({ ...f, plugin: plugin.id });
        filters.set(`${plugin.id}/${f.id}`, { ...f, plugin: plugin.id });
      }
    }
    result.matches = (filterKey, optionId) => {
      const f = filters.get(filterKey);
      if (!f) return true;
      return filterMatches(f.where, ctx.store.values().get(f.plugin)?.get(optionId));
    };
    return result;
  }, [ctx, options, values]);
}

/** Owner tools for the Reset dialog: shared property declarations and a way to append resets. */
export function useResetTools(): {
  sharedDefs: { plugin: string; pluginName: string; key: string; label: string }[];
  appendResets(entries: Extract<ExtensionEntry, { kind: "reset" }>[]): Promise<void>;
} | null {
  const ctx = useCtx();
  return ctx ? { sharedDefs: ctx.sharedDefs, appendResets: ctx.appendResets } : null;
}
