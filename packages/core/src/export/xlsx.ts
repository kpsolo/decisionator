import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Minimal Office Open XML (SpreadsheetML) workbook codec: enough to write a readable,
 * multi-sheet `.xlsx` and to read one back after it went through Excel, LibreOffice or
 * Google Sheets (shared strings, inline strings, booleans, numbers, rich text runs).
 * Formulas, styles and dates are not interpreted; cells come back as text.
 */

export type CellValue = string | number | boolean | null | undefined;

export interface SheetData {
  name: string;
  rows: CellValue[][];
  /** Column widths in characters, by column index. */
  widths?: number[];
}

/** Excel's hard limit on the text of one cell. */
export const MAX_CELL_CHARS = 32767;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

// Style indexes in styles.xml: 0 default (top-aligned, wrapped), 1 bold header.
const STYLE_HEADER = 1;

/** Characters XML 1.0 cannot carry at all; dropped from cell text. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, ent: string) => {
    if (ent === "amp") return "&";
    if (ent === "lt") return "<";
    if (ent === "gt") return ">";
    if (ent === "quot") return '"';
    if (ent === "apos") return "'";
    const code = ent.startsWith("#x") ? Number.parseInt(ent.slice(2), 16) : Number(ent.slice(1));
    return String.fromCodePoint(code);
  });
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellXml(value: CellValue, ref: string, style: number): string {
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : "";
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  if (value.length > MAX_CELL_CHARS) {
    throw new Error(`Cell ${ref} exceeds ${MAX_CELL_CHARS} characters`);
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: SheetData): string {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => cellXml(v, `${columnName(c)}${r + 1}`, r === 0 ? STYLE_HEADER : 0))
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  // Freeze the header row so long sheets stay readable.
  const views =
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  return `${XML_HEADER}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${views}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES_XML = `${XML_HEADER}<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Writes `sheets` as an `.xlsx` workbook. Sheet names must be unique, ≤ 31 chars. */
export function writeWorkbook(sheets: SheetData[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");
  files["[Content_Types].xml"] = strToU8(
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`
  );
  files["_rels/.rels"] = strToU8(
    `${XML_HEADER}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  files["xl/workbook.xml"] = strToU8(
    `${XML_HEADER}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets
      .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `${XML_HEADER}<Relationships xmlns="${NS_PKG_REL}">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join(
        ""
      )}<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`
  );
  files["xl/styles.xml"] = strToU8(STYLES_XML);
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}

/** True when `bytes` starts like a ZIP archive (every `.xlsx` does). */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m?.[1] !== undefined ? unescapeXml(m[1]) : undefined;
}

/** Concatenated text of every `<t>` run in `xml`, skipping phonetic hints. */
function textRuns(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/t>/g)) {
    out += unescapeXml(m[1] ?? "");
  }
  return out;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Reads every sheet of an `.xlsx` workbook as rows of text cells (`""` for empty cells),
 * keyed by sheet name. Throws when `bytes` is not a readable workbook.
 */
export function readWorkbook(bytes: Uint8Array): Map<string, string[][]> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("The file is not a valid .xlsx workbook");
  }
  const read = (path: string) => {
    const entry = files[path];
    return entry ? strFromU8(entry) : undefined;
  };

  const workbookPath = "xl/workbook.xml";
  const workbook = read(workbookPath);
  if (!workbook) throw new Error("The file is not a valid .xlsx workbook");

  const rels = new Map<string, string>();
  for (const m of (read("xl/_rels/workbook.xml.rels") ?? "").matchAll(
    /<Relationship\b([^>]*?)\/?>/g
  )) {
    const id = attr(m[1] ?? "", "Id");
    const target = attr(m[1] ?? "", "Target");
    if (id && target) rels.set(id, resolvePath(workbookPath, target));
  }

  const shared: string[] = [];
  for (const m of (read("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    shared.push(textRuns(m[1] ?? ""));
  }

  const result = new Map<string, string[][]>();
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const name = attr(attrs, "name");
    const rid = attr(attrs, "r:id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? read(path) : undefined;
    if (!name || !xml) continue;
    result.set(name, parseSheet(xml, shared));
  }
  return result;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(rm[1] ?? "", "r");
    const rowIndex = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const row: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cAttrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = attr(cAttrs, "r");
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = attr(cAttrs, "t");
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "inlineStr") {
        value = textRuns(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      } else if (type === "s") {
        value = shared[Number(raw)] ?? "";
      } else if (type === "b") {
        value = raw === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        value = "";
      } else if (raw !== undefined) {
        value = unescapeXml(raw);
      }
      while (row.length < col) row.push("");
      row[col] = value;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = row;
  }
  return rows;
}
