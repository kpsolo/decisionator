import { OPTION_STATUS_PLUGIN_ID, createOptionStatusPlugin } from "@decisionator/option-status";
import type { PluginDefinition } from "@decisionator/plugin-sdk";

/**
 * In-process definitions of built-in plugins that use the option-view hooks, by manifest id. Each
 * call creates a fresh instance: one per page visit. Sandboxed third-party plugins get the same
 * hooks over RPC once the runtime loader lands (contract `option-view`, US6).
 */
const factories = new Map<string, () => PluginDefinition>([
  [OPTION_STATUS_PLUGIN_ID, createOptionStatusPlugin],
]);

export function optionViewDefinition(pluginId: string): PluginDefinition | undefined {
  return factories.get(pluginId)?.();
}

/** Development only: registers example plugins (see dev-plugins.ts). */
export function registerOptionViewDefinition(pluginId: string, factory: () => PluginDefinition) {
  factories.set(pluginId, factory);
}
