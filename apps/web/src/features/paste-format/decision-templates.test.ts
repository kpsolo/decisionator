import { OptionSchema } from "@decisionator/core";
import { describe, expect, it } from "vitest";
import { DECISION_TEMPLATES } from "./decision-templates.js";

describe("Decision Templates", () => {
  it("provides valid starter decision templates", () => {
    expect(DECISION_TEMPLATES.length).toBeGreaterThanOrEqual(3);

    for (const tpl of DECISION_TEMPLATES) {
      expect(tpl.title.trim()).not.toBe("");
      expect(tpl.description.trim()).not.toBe("");
      expect(tpl.options.length).toBeGreaterThanOrEqual(3);

      const optionIds = new Set<string>();
      for (const opt of tpl.options) {
        expect(() => OptionSchema.parse(opt)).not.toThrow();
        expect(opt.title.trim()).not.toBe("");
        expect(optionIds.has(opt.id)).toBe(false);
        optionIds.add(opt.id);
      }
    }
  });
});
