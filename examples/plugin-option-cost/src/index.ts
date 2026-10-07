import type { PropertyScalar } from "@decisionator/core";
import type {
  OptionBadge,
  OptionSection,
  OptionViewContribution,
  PluginDefinition,
} from "@decisionator/plugin-sdk";

/**
 * Example option-properties plugin (feature 005, US3/US4). The manifest declares the properties;
 * the host renders, checks and stores them. This code only adds a cost badge and a "Budget"
 * section, as plain data. It has no runtime imports, so the web app can load it in development
 * (see apps/web/src/features/option-view/dev-plugins.ts).
 */
export const OPTION_COST_PLUGIN_ID = "org.decisionator.examples.option-cost";

const PRIORITY_LABELS: Record<string, string> = { low: "Low", high: "High" };

/** 420 → "€420", 12.5 → "€12.50". */
export function formatEuro(value: number): string {
  return Number.isInteger(value) ? `€${value}` : `€${value.toFixed(2)}`;
}

function asNumber(value: PropertyScalar | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createOptionCostPlugin(): PluginDefinition {
  return {
    optionView(ctx): OptionViewContribution {
      const cost = asNumber(ctx.values.cost);
      const badges: OptionBadge[] =
        cost === null ? [] : [{ text: formatEuro(cost), icon: "coins", title: "Cost per person" }];
      if (ctx.surface === "card") return { badges };

      const fields: [string, string][] = [
        ["Cost per person", cost === null ? "Not set" : formatEuro(cost)],
      ];
      const priority = ctx.values.priority;
      if (typeof priority === "string" && PRIORITY_LABELS[priority]) {
        fields.push(["Priority", PRIORITY_LABELS[priority] as string]);
      }
      const shortlisted = ctx.values.shortlisted;
      if (typeof shortlisted === "boolean") {
        fields.push(["Shortlisted by you", shortlisted ? "Yes" : "No"]);
      }
      const sections: OptionSection[] = [{ title: "Budget", blocks: [{ fields }] }];
      return { badges, sections };
    },
  };
}
