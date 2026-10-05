import { runIdeaSourceContractTests } from "@decisionator/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { PasteIdeaSourcePlugin, parsePlainList } from "../src/index.js";

describe("Plain List Parser & Paste Source (T042, T043)", () => {
  it("strips various list bullets, prefixes, and handles description splits", () => {
    const raw = `
- Item 1 — First explanation
* Item 2: Second explanation
• Item 3
1. Item 4
1) Item 5
[ ] Item 6
    `;
    const res = parsePlainList(raw);
    expect(res.candidates.length).toBe(6);
    expect(res.candidates[0]?.title).toBe("Item 1");
    expect(res.candidates[0]?.description).toBe("First explanation");
    expect(res.candidates[1]?.title).toBe("Item 2");
    expect(res.candidates[1]?.description).toBe("Second explanation");
    expect(res.candidates[2]?.title).toBe("Item 3");
    expect(res.candidates[5]?.title).toBe("Item 6");
  });

  it("handles empty lines and caps at maxItems", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `Idea number ${i + 1}`).join("\n");
    const res = parsePlainList(lines, { maxItems: 100 });
    expect(res.candidates.length).toBe(100);
    expect(res.warnings.some((w) => w.includes("capped") || w.includes("limit"))).toBe(true);
  });

  it("extracts from AI JSON payload when valid, falls back to plain list", async () => {
    const plugin = new PasteIdeaSourcePlugin();

    // Valid AI JSON
    const jsonPaste = `
\`\`\`json
{
  "format": "decisionator.options/v1",
  "options": [
    { "title": "AI Option 1", "description": "From assistant" },
    { "title": "AI Option 2" }
  ]
}
\`\`\`
    `;
    const jsonRes = await plugin.fetch({
      mode: "import",
      input: { clipboardText: jsonPaste },
    });
    expect(jsonRes.candidates.length).toBe(2);
    expect(jsonRes.candidates[0]?.title).toBe("AI Option 1");

    // Plain text fallback
    const plainPaste = "Simple task A\nSimple task B";
    const plainRes = await plugin.fetch({
      mode: "import",
      input: { clipboardText: plainPaste },
    });
    expect(plainRes.candidates.length).toBe(2);
    expect(plainRes.candidates[0]?.title).toBe("Simple task A");
  });

  runIdeaSourceContractTests(new PasteIdeaSourcePlugin());
});
