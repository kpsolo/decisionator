import { describe, expect, it } from "vitest";
import {
  MAX_EXTRACT_INPUT_LENGTH,
  extractOptionsJson,
  stripCitations,
} from "../../src/format/extract.js";

describe("extractOptionsJson input limits (SECURITY_AUDIT F15)", () => {
  it("refuses text over the length cap with a clear error", () => {
    const res = extractOptionsJson("x".repeat(MAX_EXTRACT_INPUT_LENGTH + 1));
    expect(res.kind).toBe("none");
    if (res.kind === "none") expect(res.error).toMatch(/too long/);
  });

  it("scans 100 000 unclosed fences in linear time", () => {
    const text = "```json\n".repeat(100_000);
    const started = performance.now();
    const res = extractOptionsJson(text);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(res.kind).toBe("none");
  });

  it("stays bounded with many unclosed fences and brackets", () => {
    const text = "```json\n{\n".repeat(20_000);
    const started = performance.now();
    expect(extractOptionsJson(text).kind).toBe("none");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("strips citations in linear time when many [cite: never close", () => {
    const text = "[cite: ".repeat(100_000);
    const started = performance.now();
    const res = stripCitations(text);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(res).toEqual({ cleaned: text, found: false });
  });
});

describe("fenced block scanner", () => {
  it("reads a block with CRLF line endings", () => {
    const res = extractOptionsJson('Here:\r\n```json\r\n{"options":[]}\r\n```\r\nDone');
    expect(res).toEqual({ kind: "single", json: '{"options":[]}', warnings: [] });
  });

  it("pairs each opener with the first closing fence and keeps going", () => {
    const res = extractOptionsJson('```JSON\n{"a":1}\n```\ntext\n```\n[{"b":2}]\n```\n');
    expect(res).toEqual({ kind: "choose", candidates: ['{"a":1}', '[{"b":2}]'] });
  });

  it("does not end a block at a fence that is not alone on its line", () => {
    const res = extractOptionsJson('```json\n{"t":"x"}\n  ``` trailing\n```\n');
    expect(res.kind).toBe("single");
    if (res.kind === "single") expect(res.json).toBe('{"t":"x"}\n  ``` trailing');
  });

  it("strips every citation form", () => {
    expect(stripCitations("a[cite_start]b[cite: 1, 2]c[cite_end]d[cite]e[citex]")).toEqual({
      cleaned: "abcde[citex]",
      found: true,
    });
  });
});
