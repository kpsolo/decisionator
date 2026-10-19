import { describe, expect, it } from "vitest";
import { CARD_IGNORE_SELECTOR, isActivationKey, shouldActivateCard } from "./card-activation.js";

/** A tiny fake DOM node: `match` is the selector part (from the ignore list) it satisfies. */
class FakeNode {
  constructor(
    readonly parent: FakeNode | null,
    readonly match?: string
  ) {}
  closest(selector: string): FakeNode | null {
    const parts = selector.split(",").map((s) => s.trim());
    for (let n: FakeNode | null = this; n; n = n.parent) {
      if (n.match && parts.includes(n.match)) return n;
    }
    return null;
  }
  contains(other: FakeNode): boolean {
    for (let n: FakeNode | null = other; n; n = n.parent) if (n === this) return true;
    return false;
  }
}

describe("shouldActivateCard", () => {
  const root = new FakeNode(null);
  const card = new FakeNode(root, "li");
  const title = new FakeNode(card);

  it("activates for plain card content", () => {
    expect(shouldActivateCard(title, card)).toBe(true);
    expect(shouldActivateCard(card, card)).toBe(true);
  });

  it.each([
    "button",
    "input",
    "textarea",
    "select",
    "a",
    "label",
    "[contenteditable]:not([contenteditable='false'])",
    "[data-card-ignore]",
  ])("ignores events from inside %s", (sel) => {
    expect(CARD_IGNORE_SELECTOR).toContain(sel);
    const control = new FakeNode(card, sel);
    const inner = new FakeNode(control);
    expect(shouldActivateCard(control, card)).toBe(false);
    expect(shouldActivateCard(inner, card)).toBe(false);
  });

  it("ignores events from portalled content outside the card (the detail dialog)", () => {
    const dialog = new FakeNode(root, "[role='dialog']");
    const textarea = new FakeNode(dialog, "textarea");
    const text = new FakeNode(dialog);
    expect(shouldActivateCard(textarea, card)).toBe(false);
    expect(shouldActivateCard(text, card)).toBe(false);
  });

  it("still activates when the card itself sits inside an ignored ancestor", () => {
    const dialog = new FakeNode(null, "[role='dialog']");
    const nestedCard = new FakeNode(dialog, "li");
    const content = new FakeNode(nestedCard);
    expect(shouldActivateCard(content, nestedCard)).toBe(true);
  });

  it("ignores non-element targets", () => {
    expect(shouldActivateCard(null, card)).toBe(false);
    expect(shouldActivateCard({}, card)).toBe(false);
  });
});

describe("isActivationKey", () => {
  it("accepts Enter and Space only", () => {
    expect(isActivationKey("Enter")).toBe(true);
    expect(isActivationKey(" ")).toBe(true);
    expect(isActivationKey("a")).toBe(false);
    expect(isActivationKey("Tab")).toBe(false);
  });
});
