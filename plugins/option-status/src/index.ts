import type { PropertyScalar } from "@decisionator/core";
import type { OptionViewContribution, PluginDefinition } from "@decisionator/plugin-sdk";

/**
 * Personal option status (feature 005): marks an option "Seen" for the viewer once it has stayed
 * on screen long enough, and shows unseen options like unread mail. It uses only the public
 * option-properties and option-view hooks; disabling it removes the feature.
 */
export const OPTION_STATUS_PLUGIN_ID = "org.decisionator.option-status";

const KEY = "seen";
const DEFAULT_SECONDS = 5;

type Seen = "seen" | "seen_auto" | "not_seen";

function isNew(value: PropertyScalar | undefined): boolean {
  return value === undefined || value === null || value === "not_seen";
}

function seconds(settings: Record<string, unknown>): number {
  const s = settings.seconds;
  return typeof s === "number" && Number.isInteger(s) && s >= 1 && s <= 300 ? s : DEFAULT_SECONDS;
}

/** One instance per page visit: a manual "not seen" holds only until the viewer comes back. */
export function createOptionStatusPlugin(): PluginDefinition {
  const heldNotSeen = new Set<string>();

  const set = (value: Seen) => value;

  return {
    exposureMs(settings) {
      return settings.autoMark === false ? null : seconds(settings) * 1000;
    },

    optionView(ctx): OptionViewContribution {
      const fresh = isNew(ctx.values[KEY]);
      // Cards stay quiet, like a mail list: only the marker. The manual actions live in the
      // detail view.
      const footer =
        ctx.surface === "card"
          ? []
          : [
              fresh
                ? { action: { id: "mark-seen", label: "Mark as seen" } }
                : { action: { id: "mark-not-seen", label: "Mark as not seen" } },
            ];
      return {
        marker: fresh
          ? { variant: "dot", label: "Not seen", tone: "primary", replace: true }
          : null,
        footer,
      };
    },

    optionList(ctx) {
      const count = ctx.options.filter((o) => isNew(ctx.valuesByOption[o.id]?.[KEY])).length;
      return {
        ...(count > 0 ? { summary: { text: `${count} not seen yet` } } : {}),
        filters: [
          { id: "unseen", label: "Only not seen", where: { key: KEY, in: [null, "not_seen"] } },
        ],
      };
    },

    async onOptionAction(ctx, actionId) {
      if (actionId === "mark-seen") {
        heldNotSeen.delete(ctx.option.id);
        await ctx.setValue(KEY, set("seen"));
      } else if (actionId === "mark-not-seen") {
        heldNotSeen.add(ctx.option.id);
        await ctx.setValue(KEY, set("not_seen"));
      }
    },

    async onOptionExposed(ctx, optionIds) {
      const changes = optionIds
        .filter((id) => !heldNotSeen.has(id) && isNew(ctx.valuesByOption[id]?.[KEY]))
        .map((optionId) => ({ optionId, key: KEY, value: set("seen_auto") }));
      if (changes.length > 0) await ctx.setValues(changes);
    },
  };
}
