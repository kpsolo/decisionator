import { describe, expect, it } from "vitest";
import { validateContribution, validateListContribution } from "../src/option-view.js";

describe("validateContribution", () => {
  it("keeps valid places", () => {
    const { value, droppedPlaces } = validateContribution(
      {
        marker: { variant: "dot", label: "Not seen", tone: "primary", replace: true },
        badges: [{ text: "€420", tone: "info", icon: "coins" }],
        footer: [{ action: { id: "mark-seen", label: "Mark as seen" } }, { text: "Added by Ana" }],
        sections: [{ title: "Budget", blocks: [{ fields: [["Cost", "420"]] }] }],
      },
      "detail"
    );
    expect(droppedPlaces).toEqual([]);
    expect(value.badges).toHaveLength(1);
    expect(value.sections?.[0]?.title).toBe("Budget");
  });

  it.each([
    ["badges", { badges: Array.from({ length: 4 }, () => ({ text: "x" })) }],
    ["badges", { badges: [{ text: "x".repeat(25) }] }],
    ["footer", { footer: Array.from({ length: 4 }, () => ({ text: "x" })) }],
    [
      "sections",
      { sections: Array.from({ length: 3 }, () => ({ title: "t", blocks: [{ text: "b" }] })) },
    ],
    ["marker", { marker: { variant: "blink", label: "x" } }],
    ["marker", { marker: { variant: "dot", label: "x", tone: "pink" } }],
  ])("drops an invalid %s place and keeps the rest", (place, raw) => {
    const { value, droppedPlaces } = validateContribution(
      { ...raw, footer: (raw as { footer?: unknown }).footer ?? [{ text: "kept" }] },
      "detail"
    );
    expect(droppedPlaces).toContain(place);
    expect(value).not.toHaveProperty(place);
    if (place !== "footer") expect(value.footer).toEqual([{ text: "kept" }]);
  });

  it("never carries places that are not part of the contract", () => {
    const { value } = validateContribution(
      { title: "Hacked", grade: null, comments: [], badges: [{ text: "ok" }] },
      "card"
    );
    expect(Object.keys(value)).toEqual(["badges"]);
  });

  it("ignores sections on the card", () => {
    const { value, droppedPlaces } = validateContribution(
      { sections: [{ title: "Budget", blocks: [{ text: "x" }] }] },
      "card"
    );
    expect(value.sections).toBeUndefined();
    expect(droppedPlaces).toEqual([]);
  });

  it("treats a non-object result as all places failing", () => {
    expect(validateContribution("oops", "card").droppedPlaces).toHaveLength(4);
    expect(validateContribution(undefined, "card").droppedPlaces).toEqual([]);
  });
});

describe("validateListContribution", () => {
  it("accepts a summary of up to 40 characters and filters", () => {
    const { value } = validateListContribution({
      summary: { text: "9 not seen yet" },
      filters: [
        { id: "unseen", label: "Only not seen", where: { key: "seen", in: [null, "not_seen"] } },
      ],
    });
    expect(value.summary?.text).toBe("9 not seen yet");
    expect(value.filters).toHaveLength(1);
  });

  it("drops a summary over 40 characters", () => {
    const { value, droppedPlaces } = validateListContribution({
      summary: { text: "x".repeat(41) },
    });
    expect(value.summary).toBeUndefined();
    expect(droppedPlaces).toEqual(["summary"]);
  });
});
