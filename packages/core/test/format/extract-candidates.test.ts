import { describe, expect, it } from "vitest";
import { extractOptionsJson } from "../../src/format/extract.js";
import { validateOptionsPayload } from "../../src/format/validate.js";

const payload = {
  format: "decisionator.options/v1",
  options: [{ title: "Visit Museum" }, { title: "Go Hiking" }],
};
const json = JSON.stringify(payload);

describe("extractOptionsJson: candidate selection", () => {
  it("skips a bracketed aside before the JSON object", () => {
    const res = extractOptionsJson(`Here are the options [as requested]: ${json} Enjoy!`);
    expect(res).toMatchObject({ kind: "single" });
    if (res.kind === "single") expect(JSON.parse(res.json)).toEqual(payload);
  });

  it("prefers an options payload over a parseable bracketed number", () => {
    const res = extractOptionsJson(`Pick [1] of these: ${json}`);
    expect(res.kind).toBe("single");
    if (res.kind === "single") expect(JSON.parse(res.json)).toEqual(payload);
  });

  it("still accepts a bare array of options after prose", () => {
    const arr = [{ title: "One" }, { title: "Two" }];
    const res = extractOptionsJson(`(see notes) ${JSON.stringify(arr)}`);
    expect(res.kind).toBe("single");
    if (res.kind === "single") expect(JSON.parse(res.json)).toEqual(arr);
  });

  it("returns the first balanced candidate when nothing parses, so validation can report it", () => {
    const broken = `{"options":[{"title":"A",}]}`;
    const res = extractOptionsJson(`Result: ${broken}`);
    expect(res).toEqual({ kind: "single", json: broken, warnings: [] });
  });

  it("does not end a fenced block at ``` inside a JSON string", () => {
    const inner = {
      format: "decisionator.options/v1",
      options: [{ title: "Use ``` fences", description: "Wrap code in ```ts ... ``` blocks." }],
    };
    const text = `Here you go:\n\`\`\`json\n${JSON.stringify(inner, null, 2)}\n\`\`\`\nDone.`;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("single");
    if (res.kind === "single") {
      expect(JSON.parse(res.json)).toEqual(inner);
      const val = validateOptionsPayload(res.json);
      expect(val.ok && val.options[0]?.title).toBe("Use ``` fences");
    }
  });

  it("ignores ``` that does not start a line when counting fenced blocks", () => {
    const text = `Inline \`\`\`json mention\`\`\` first.\n\`\`\`json\n${json}\n\`\`\``;
    const res = extractOptionsJson(text);
    expect(res.kind).toBe("single");
    if (res.kind === "single") expect(JSON.parse(res.json)).toEqual(payload);
  });
});
