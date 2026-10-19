import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractOptionsJson } from "../../src/format/extract.js";
import { type ValidateResult, validateOptionsPayload } from "../../src/format/validate.js";
import { OptionSchema } from "../../src/model/option.js";

const FORMAT = "decisionator.options/v1";
const validate = (payload: unknown) => validateOptionsPayload(JSON.stringify(payload));

function expectSchemaValid(result: ValidateResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  result.options.forEach((opt, i) => {
    const parsed = OptionSchema.safeParse({ ...opt, id: opt.id ?? `opt_${i}` });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
}

describe("validateOptionsPayload: OptionSchema limits", () => {
  it("rejects a title that is empty after citation stripping", () => {
    const res = validate({ format: FORMAT, options: [{ title: "[cite: 3]" }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes("options[0].title"))).toBe(true);
  });

  it("rejects an unsupported format id or version", () => {
    for (const format of ["decisionator.options/v99", "other.options/v1", 1]) {
      const res = validate({ format, options: [{ title: "A" }] });
      expect(res.ok, String(format)).toBe(false);
      if (!res.ok) expect(res.errors.some((e) => e.startsWith("format"))).toBe(true);
    }
  });

  it("accepts an object without format, with a warning", () => {
    const res = validate({ options: [{ title: "A" }] });
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.includes("format"))).toBe(true);
  });

  it("truncates pros and cons longer than 300 chars", () => {
    const long = "p".repeat(350);
    const res = validate({ format: FORMAT, options: [{ title: "A", pros: [long], cons: long }] });
    expectSchemaValid(res);
    if (res.ok) {
      expect(res.options[0]?.pros[0]?.length).toBe(300);
      expect(res.options[0]?.cons[0]?.length).toBe(300);
    }
    expect(res.warnings.some((w) => w.includes("pros") && w.includes("truncated"))).toBe(true);
  });

  it("keeps only http(s) links that parse as URLs", () => {
    const res = validate({
      format: FORMAT,
      options: [
        {
          title: "A",
          links: [
            "httpevil:x",
            "http:example.com",
            "https://ok.example/a",
            { url: "javascript:alert(1)" },
            { url: "HTTP://Upper.example", title: "t".repeat(250) },
            "https://",
          ],
        },
      ],
    });
    expectSchemaValid(res);
    if (res.ok) {
      expect(res.options[0]?.links.map((l) => l.url)).toEqual([
        "https://ok.example/a",
        "http://Upper.example",
      ]);
      expect(res.options[0]?.links[1]?.title?.length).toBe(200);
    }
  });

  it("drops a category that is empty after citation stripping", () => {
    const res = validate({ format: FORMAT, options: [{ title: "A", category: "[cite: 1]" }] });
    expectSchemaValid(res);
    if (res.ok) expect(res.options[0]?.category).toBeUndefined();
  });

  it("every validated fixture answer parses with OptionSchema", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/format-answers"
    );
    let checked = 0;
    for (const version of fs.readdirSync(root)) {
      const answers = path.join(root, version, "answers");
      if (!fs.existsSync(answers)) continue;
      for (const sample of fs.readdirSync(answers)) {
        const dir = path.join(answers, sample);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
          const extracted = extractOptionsJson(fs.readFileSync(path.join(dir, file), "utf-8"));
          if (extracted.kind !== "single") continue;
          const res = validateOptionsPayload(extracted.json, extracted.warnings);
          if (!res.ok) continue;
          expectSchemaValid(res);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
