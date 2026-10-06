import { describe, expect, it } from "vitest";
import { detectOptionsJson } from "./options-json.js";

const payload = {
  format: "decisionator.options/v1",
  project: { title: "Weekend plans", description: "What to do on Saturday" },
  options: [
    { title: "Picnic in the park", description: "Bring food.", category: "Outdoors", effort: "xs" },
    { title: "Board games", tags: ["indoors"] },
  ],
};

describe("detectOptionsJson", () => {
  it("ignores plain idea lists, including ones with brackets", () => {
    expect(detectOptionsJson("- Picnic\n- Board games")).toEqual({ kind: "none" });
    expect(detectOptionsJson("1. Ship v2 [draft]\n2. Hire {maybe}")).toEqual({ kind: "none" });
    expect(detectOptionsJson("[Q4] Hire a designer\n[Q1] Rebrand")).toEqual({ kind: "none" });
    expect(detectOptionsJson("")).toEqual({ kind: "none" });
  });

  it("accepts bare pretty-printed JSON with project metadata", () => {
    const result = detectOptionsJson(JSON.stringify(payload, null, 2));
    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.project).toEqual({
      title: "Weekend plans",
      description: "What to do on Saturday",
    });
    expect(result.options.map((o) => o.title)).toEqual(["Picnic in the park", "Board games"]);
    expect(result.options[0]).toMatchObject({ order: 1, status: "active", effort: "XS" });
    expect(new Set(result.options.map((o) => o.id)).size).toBe(2);
  });

  it("accepts a fenced block wrapped in assistant chat text and citation markers", () => {
    const answer = `Sure! Here is your list [cite: 1]:\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\nLet me know if you need changes.`;
    const result = detectOptionsJson(answer);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(result.options).toHaveLength(2);
  });

  it("accepts a bare options array", () => {
    const result = detectOptionsJson('[{"title":"A"},{"title":"B"}]');
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(result.project).toBeUndefined();
  });

  it("picks the first valid block when the agent returns several", () => {
    const answer = `\`\`\`json\n{"oops": true}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
    expect(detectOptionsJson(answer).kind).toBe("valid");
  });

  it("reports validation errors for JSON that is not an options payload", () => {
    const result = detectOptionsJson('{"options": [{"name": "missing title"}]}');
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.errors[0]).toMatch(/title/);
  });

  it("reports parse errors for truncated JSON", () => {
    const result = detectOptionsJson('{"options": [{"title": "A"}');
    expect(result.kind).toBe("invalid");
  });
});
