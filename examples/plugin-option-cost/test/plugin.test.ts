import { OptionPropertyDefinitionSchema, type PropertyScalar } from "@decisionator/core";
import { type OptionViewContext, validateContribution } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import manifest from "../decisionator-plugin.json";
import { OPTION_COST_PLUGIN_ID, createOptionCostPlugin, formatEuro } from "../src/index.js";

function ctx(
  values: Record<string, PropertyScalar>,
  surface: "card" | "detail" = "detail"
): OptionViewContext {
  return {
    option: {
      id: "lis",
      title: "Lisbon",
      description: "",
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    },
    viewerId: "gina",
    surface,
    values,
    settings: {},
    setValue: async () => {},
  };
}

describe("option cost example plugin", () => {
  it("declares cost, shortlisted and priority under its own id", () => {
    expect(manifest.id).toBe(OPTION_COST_PLUGIN_ID);
    const defs = manifest.provides.optionProperties.map((d) =>
      OptionPropertyDefinitionSchema.parse(d)
    );
    expect(defs.map((d) => [d.key, d.label, d.type, d.scope])).toEqual([
      ["cost", "Cost per person", "number", "shared"],
      ["shortlisted", "Shortlisted", "boolean", "person"],
      ["priority", "Priority", "choice", "shared"],
    ]);
    expect(defs[0]?.cardBadge).toBe(true);
    expect(defs[2]?.choices?.map((c) => c.value)).toEqual(["low", "high"]);
  });

  it("formats costs in euros", () => {
    expect(formatEuro(420)).toBe("€420");
    expect(formatEuro(12.5)).toBe("€12.50");
  });

  it("adds a €420 badge on the card and no section there", async () => {
    const view = await createOptionCostPlugin().optionView?.(ctx({ cost: 420 }, "card"));
    expect(view).toEqual({ badges: [{ text: "€420", icon: "coins", title: "Cost per person" }] });
    const checked = validateContribution(view, "card");
    expect(checked.droppedPlaces).toEqual([]);
  });

  it("adds no badge without a cost", async () => {
    const view = await createOptionCostPlugin().optionView?.(ctx({}, "card"));
    expect(view?.badges).toEqual([]);
  });

  it("adds a Budget section with fields in the detail view", async () => {
    const view = await createOptionCostPlugin().optionView?.(
      ctx({ cost: 420, priority: "high", shortlisted: true })
    );
    expect(view?.sections).toEqual([
      {
        title: "Budget",
        blocks: [
          {
            fields: [
              ["Cost per person", "€420"],
              ["Priority", "High"],
              ["Shortlisted by you", "Yes"],
            ],
          },
        ],
      },
    ]);
    const checked = validateContribution(view, "detail");
    expect(checked.droppedPlaces).toEqual([]);
    expect(checked.value.sections).toHaveLength(1);
  });

  it("shows 'Not set' when there is no cost and skips unknown values", async () => {
    const view = await createOptionCostPlugin().optionView?.(ctx({ priority: "urgent" }));
    expect(view?.sections?.[0]?.blocks).toEqual([{ fields: [["Cost per person", "Not set"]] }]);
  });
});
