import type { Option } from "@decisionator/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedOptionView } from "./OptionExtensionsProvider.js";
import {
  OptionBadges,
  OptionFooter,
  OptionMarker,
  OptionMarkerFrame,
  OptionSections,
  markerTitleClass,
} from "./OptionPlaces.js";

const view = (patch: Partial<ResolvedOptionView>): ResolvedOptionView => ({
  marker: null,
  badges: [],
  footer: [],
  sections: [],
  failed: [],
  ...patch,
});

const option = { id: "lis", title: "Lisbon" } as Option;

describe("option view places", () => {
  it("draws the dot marker with a hidden label and a bolder title", () => {
    const v = view({ marker: { variant: "dot", label: "Not seen", tone: "primary", plugin: "p" } });
    const html = renderToStaticMarkup(<OptionMarker view={v} />);
    expect(html).toContain('data-option-marker="dot"');
    expect(html).toContain('<span class="sr-only">Not seen</span>');
    expect(markerTitleClass(v)).toBe("font-extrabold");
    expect(renderToStaticMarkup(<OptionMarkerFrame view={v} />)).toBe("");
  });

  it("draws a bar marker on the card edge, decorative only", () => {
    const v = view({ marker: { variant: "bar", label: "Not seen", tone: "info", plugin: "p" } });
    expect(renderToStaticMarkup(<OptionMarkerFrame view={v} />)).toContain('aria-hidden="true"');
    expect(markerTitleClass(v)).toBeUndefined();
  });

  it("renders badges and the fallback notice when a plugin failed", () => {
    const html = renderToStaticMarkup(
      <OptionBadges
        view={view({ badges: [{ text: "€420", icon: "coins", plugin: "p" }], failed: ["q"] })}
      />
    );
    expect(html).toContain("€420");
    expect(html).toContain("A plugin could not display here.");
  });

  it("renders footer actions as buttons and text as text", () => {
    const html = renderToStaticMarkup(
      <OptionFooter
        option={option}
        view={view({
          footer: [
            { action: { id: "mark-seen", label: "Mark as seen" }, plugin: "p" },
            { text: "Added by Ana", plugin: "p" },
          ],
        })}
      />
    );
    expect(html).toMatch(/<button[^>]*>.*Mark as seen<\/button>/);
    expect(html).toContain("Added by Ana");
  });

  // Markdown blocks use the same DOMPurify sanitizing as comments, which needs a browser DOM, so
  // they are not exercised in these Node tests.
  it("renders sections with fields", () => {
    const html = renderToStaticMarkup(
      <OptionSections
        view={view({
          sections: [
            {
              title: "Budget",
              plugin: "p",
              blocks: [{ fields: [["Per person", "€420"]] }, { text: "Flights included" }],
            },
          ],
        })}
      />
    );
    expect(html).toContain("Budget");
    expect(html).toContain("<dt");
    expect(html).toContain("Flights included");
  });
});
