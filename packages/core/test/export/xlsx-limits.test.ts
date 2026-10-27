import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_XLSX_ENTRY_BYTES, readWorkbook, writeWorkbook } from "../../src/export/xlsx.js";

const MB = 1024 * 1024;

/** Offset of the central directory entry of `name` in a zip (signature 0x02014b50). */
function centralEntry(zip: Uint8Array, name: string): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const target = strToU8(name);
  for (let i = 0; i + 46 < zip.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const len = view.getUint16(i + 28, true);
    const got = zip.subarray(i + 46, i + 46 + len);
    if (len === target.length && got.every((b, k) => b === target[k])) return i;
  }
  throw new Error(`no central entry for ${name}`);
}

describe("readWorkbook decompression budget (SECURITY_AUDIT F15)", () => {
  it("rejects a high-ratio entry from its declared size without inflating it", () => {
    const bomb = zipSync({ "xl/workbook.xml": new Uint8Array(MAX_XLSX_ENTRY_BYTES + MB) });
    expect(bomb.length).toBeLessThan(MB); // > 25 MB inflated from well under 1 MB
    expect(() => readWorkbook(bomb)).toThrow(/too large/);
  });

  it("rejects entries whose total inflated size exceeds the budget", () => {
    const part = new Uint8Array(20 * MB);
    const bomb = zipSync({
      "xl/workbook.xml": part,
      "xl/sharedStrings.xml": part,
      "xl/worksheets/sheet1.xml": part,
    });
    expect(() => readWorkbook(bomb)).toThrow(/too large/);
  });

  it("never inflates more than a lying header declares", () => {
    const bomb = zipSync({ "xl/workbook.xml": new Uint8Array(30 * MB) });
    // Understate the uncompressed size in the central directory (offset 24, uint32 LE).
    const at = centralEntry(bomb, "xl/workbook.xml");
    new DataView(bomb.buffer, bomb.byteOffset).setUint32(at + 24, 1024, true);
    const started = performance.now();
    // The 30 MB of zeros come back as at most the 1 KiB declared: no sheet is found.
    let sheets: Map<string, string[][]> | undefined;
    try {
      sheets = readWorkbook(bomb);
    } catch (err) {
      expect(String(err)).toMatch(/not a valid \.xlsx workbook|too large/);
    }
    if (sheets) expect(sheets.size).toBe(0);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("skips non-XML parts such as media without inflating them", () => {
    const parts = unzipSync(writeWorkbook([{ name: "Options", rows: [["a", "b"]] }]));
    parts["xl/media/image1.png"] = new Uint8Array(30 * MB);
    const sheets = readWorkbook(zipSync(parts));
    expect(sheets.get("Options")).toEqual([["a", "b"]]);
  });
});
