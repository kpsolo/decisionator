import { describe, expect, it } from "vitest";
import { extractOptionsJson } from "../../src/format/extract.js";
import { validateOptionsPayload } from "../../src/format/validate.js";

describe("Format Extraction & Validation (T035)", () => {
  it("prefers a fenced ```json block over surrounding text", () => {
    const text = `
Here is your JSON:
\`\`\`json
{
  "format": "decisionator.options/v1",
  "project": { "title": "Trip Plans" },
  "options": [
    { "title": "Visit Museum", "description": "Go to city art museum." }
  ]
}
\`\`\`
Hope that helps!
    `;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("single");
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(true);
      if (val.ok) {
        expect(val.project?.title).toBe("Trip Plans");
        expect(val.options.length).toBe(1);
        expect(val.options[0]?.title).toBe("Visit Museum");
      }
    }
  });

  it("returns 'choose' when multiple fenced ```json blocks are present", () => {
    const text = `
Option 1:
\`\`\`json
{"format":"decisionator.options/v1","options":[{"title":"One"}]}
\`\`\`
Option 2:
\`\`\`json
{"format":"decisionator.options/v1","options":[{"title":"Two"}]}
\`\`\`
    `;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("choose");
    if (res.kind === "choose") {
      expect(res.candidates.length).toBe(2);
    }
  });

  it("falls back to balanced { ... } when no code fence is present", () => {
    const text = `Sure! {"format":"decisionator.options/v1","options":[{"title":"Direct Object"}]} is your result.`;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("single");
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(true);
      if (val.ok) {
        expect(val.options[0]?.title).toBe("Direct Object");
      }
    }
  });

  it("accepts a bare array as options with a warning", () => {
    const text = `[{"title":"First Item"},{"title":"Second Item"}]`;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("single");
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(true);
      expect(val.warnings.some((w) => w.includes("bare array"))).toBe(true);
      if (val.ok) {
        expect(val.options.length).toBe(2);
      }
    }
  });

  it("ignores unknown fields and emits warnings", () => {
    const text = `{"format":"decisionator.options/v1","unknownField":"ignore me","options":[{"title":"Valid","extraStuff":123}]}`;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("single");
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(true);
      expect(
        val.warnings.some(
          (w) => w.includes("unknown") || w.includes("extraStuff") || w.includes("unknownField")
        )
      ).toBe(true);
    }
  });

  it("truncates over-length strings with a warning", () => {
    const longTitle = "A".repeat(300); // Max is 200
    const text = JSON.stringify({
      format: "decisionator.options/v1",
      options: [{ title: longTitle, description: "Valid desc" }],
    });
    const res = extractOptionsJson(text);
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(true);
      if (val.ok) {
        expect(val.options[0]?.title.length).toBe(200);
      }
      expect(val.warnings.some((w) => w.includes("truncated") || w.includes("length"))).toBe(true);
    }
  });

  it("strips citation markers like [cite: 5] and [cite_start] with a warning", () => {
    const text = JSON.stringify({
      format: "decisionator.options/v1",
      options: [
        {
          title: "Option with citation [cite: 5]",
          description: "Details here [cite_start] according to source [cite_end].",
        },
      ],
    });
    const res = extractOptionsJson(text);
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json, res.warnings);
      expect(val.ok).toBe(true);
      if (val.ok) {
        expect(val.options[0]?.title).toBe("Option with citation");
        expect(val.options[0]?.description).toBe("Details here  according to source .");
      }
      expect(val.warnings.some((w) => w.includes("citation"))).toBe(true);
    }
  });

  it("wraps single strings in tags/pros/cons into a one-item list with a warning", () => {
    const text = JSON.stringify({
      format: "decisionator.options/v1",
      options: [
        {
          title: "Wrapped Items",
          tags: "single-tag",
          pros: "fast execution",
          cons: "needs budget",
        },
      ],
    });
    const res = extractOptionsJson(text);
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(true);
      if (val.ok) {
        expect(val.options[0]?.tags).toEqual(["single-tag"]);
        expect(val.options[0]?.pros).toEqual(["fast execution"]);
        expect(val.options[0]?.cons).toEqual(["needs budget"]);
      }
      expect(val.warnings.some((w) => w.includes("wrapped"))).toBe(true);
    }
  });

  it("reports precise error messages for invalid fields", () => {
    const text = JSON.stringify({
      format: "decisionator.options/v1",
      options: [
        { title: "Valid 1" },
        { title: "Valid 2" },
        { description: "Missing title" }, // options[2].title missing
      ],
    });
    const res = extractOptionsJson(text);
    if (res.kind === "single") {
      const val = validateOptionsPayload(res.json);
      expect(val.ok).toBe(false);
      if (!val.ok) {
        expect(val.errors.some((e) => e.includes("options[2].title"))).toBe(true);
      }
    }
  });
});
