import type { PropertyScalar } from "@decisionator/core";
import type { OptionViewContribution, PluginDefinition } from "@decisionator/plugin-sdk";

/**
 * Example marker plugin (feature 005, US4): keeps its own per-person "seen" property and shows
 * unseen options with a blue bar. It declares `replaces: ["marker"]`, so it competes with the
 * built-in status plugin's dot; the viewer picks one in Settings ("Marker style"). It has no
 * runtime imports, so the web app can load it in development.
 */
export const UNREAD_BAR_PLUGIN_ID = "org.decisionator.examples.unread-bar";

const KEY = "seen";
const DEFAULT_SECONDS = 5;

function isUnseen(value: PropertyScalar | undefined): boolean {
  return value !== "seen";
}

function seconds(settings: Record<string, unknown>): number {
  const s = settings.seconds;
  return typeof s === "number" && Number.isInteger(s) && s >= 1 && s <= 300 ? s : DEFAULT_SECONDS;
}

export function createUnreadBarPlugin(): PluginDefinition {
  return {
    exposureMs(settings) {
      return seconds(settings) * 1000;
    },

    optionView(ctx): OptionViewContribution {
      const unseen = isUnseen(ctx.values[KEY]);
      const footer =
        ctx.surface === "card"
          ? []
          : [
              unseen
                ? { action: { id: "mark-seen", label: "Mark as seen" } }
                : { action: { id: "mark-not-seen", label: "Mark as not seen" } },
            ];
      return {
        marker: unseen ? { variant: "bar", label: "Not seen", tone: "info", replace: true } : null,
        footer,
      };
    },

    async onOptionAction(ctx, actionId) {
      if (actionId === "mark-seen") await ctx.setValue(KEY, "seen");
      else if (actionId === "mark-not-seen") await ctx.setValue(KEY, "not_seen");
    },

    async onOptionExposed(ctx, optionIds) {
      // Only options with no mark yet: a manual "not seen" stays until the viewer changes it.
      const changes = optionIds
        .filter((id) => ctx.valuesByOption[id]?.[KEY] === undefined)
        .map((optionId) => ({ optionId, key: KEY, value: "seen" }));
      if (changes.length > 0) await ctx.setValues(changes);
    },
  };
}
