/**
 * Decides whether a click or Enter/Space keypress on an option card should open its detail
 * view. Events that start in a control, a text field, or anything outside the card's own DOM
 * (React events bubble through portals, so the detail dialog's comment box reaches the card's
 * handlers) must be left alone.
 */

/** Elements inside the card that handle their own pointer and keyboard input. */
export const CARD_IGNORE_SELECTOR = [
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "fieldset",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='dialog']",
  "[data-card-ignore]",
].join(", ");

/** The minimal DOM surface the predicate needs (keeps it testable without a DOM). */
export interface CardEventTarget {
  closest(selector: string): unknown;
}

export interface CardElement {
  contains(node: never): boolean;
}

export function shouldActivateCard(target: unknown, card: CardElement): boolean {
  if (!target || typeof (target as CardEventTarget).closest !== "function") return false;
  // Portalled content (the detail dialog) is not in the card's DOM subtree.
  if (!card.contains(target as never)) return false;
  const hit = (target as CardEventTarget).closest(CARD_IGNORE_SELECTOR);
  // Only matches inside the card count; the card itself may sit in an ignored ancestor.
  return !(hit && card.contains(hit as never));
}

/** Enter and Space activate the card, as for a button. */
export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
