import type { ZodError } from "zod";
import type { Option } from "../model/option.js";
import { computeOptionStats } from "../stats/aggregate.js";
import { latestOutcome } from "../voting/rounds.js";
import {
  PROJECT_EXPORT_FORMAT,
  type ProjectExportV1,
  ProjectExportV1Schema,
} from "./project-v1.js";
import {
  type CellValue,
  MAX_CELL_CHARS,
  type SheetData,
  readWorkbook,
  writeWorkbook,
} from "./xlsx.js";

/**
 * `.xlsx` form of a `decisionator.project/v1` bundle. It opens in Excel, LibreOffice and Google
 * Sheets (File → Import), and the same workbook — also after it was edited and downloaded again
 * as `.xlsx` — restores the project. Layout: `docs/project-export.md`.
 *
 * Columns are found by header name, so their order may change and extra columns are ignored.
 * Outcomes and contributions keep their full record as JSON (split over `Record (JSON)` columns
 * when longer than one cell can hold), so restored outcomes still verify.
 */

export const XLSX_SHEETS = {
  project: "Project",
  ranking: "Ranking",
  options: "Options",
  grades: "Grades",
  ballots: "Ballots",
  comments: "Comments",
  outcomes: "Outcomes",
  contributions: "Contributions",
} as const;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const RECORD_JSON = "Record (JSON)";
/** Chunk size for JSON records; below Excel's cell limit with room for escaping. */
const JSON_CHUNK = 30000;

const PROJECT_FIELDS = {
  format: "Format",
  exportedAt: "Exported at",
  title: "Title",
  description: "Description",
  owner: "Owner",
  createdAt: "Created at",
  votingState: "Voting state",
  votingRound: "Voting round",
  topN: "Ballot size (top N)",
  liveResults: "Live results",
  rankedBy: "Ranked by (latest outcome)",
} as const;

const lines = (values: readonly string[] | undefined) => (values ?? []).join("\n");

function chunkJson(value: unknown): string[] {
  const json = JSON.stringify(value);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += JSON_CHUNK) chunks.push(json.slice(i, i + JSON_CHUNK));
  return chunks.length ? chunks : [""];
}

function jsonHeaders(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? RECORD_JSON : `${RECORD_JSON} ${i + 1}`
  );
}

/** Rows plus trailing JSON chunk columns, padded so every row has the same width. */
function withJsonRecords<T>(
  header: string[],
  items: readonly T[],
  cells: (item: T) => CellValue[]
): CellValue[][] {
  const chunked = items.map((item) => chunkJson(item));
  const width = Math.max(1, ...chunked.map((c) => c.length));
  return [
    [...header, ...jsonHeaders(width)],
    ...items.map((item, i) => [...cells(item), ...(chunked[i] ?? [])]),
  ];
}

function rankingRows(bundle: ProjectExportV1): { rows: CellValue[][]; rankedBy: string } {
  const stats = computeOptionStats(bundle.options, bundle.grades, bundle.comments);
  const round = bundle.project.voting.round;
  const outcome = latestOutcome(bundle.outcomes, round);
  const optionTitle = new Map(bundle.options.map((o) => [o.id, o.title]));
  const ballots = bundle.rankings.filter((r) => (r.round ?? 1) === round);

  let ordered: { optionId: string; points?: number; firstPlaces?: number }[];
  if (outcome) {
    const seen = new Set(outcome.result.order.map((o) => o.optionId));
    ordered = [
      ...outcome.result.order,
      ...bundle.options.filter((o) => !seen.has(o.id)).map((o) => ({ optionId: o.id })),
    ];
  } else {
    // No decision yet: order by average grade, then number of grades.
    ordered = [...bundle.options]
      .sort((a, b) => {
        const sa = stats.get(a.id);
        const sb = stats.get(b.id);
        return (sb?.average ?? 0) - (sa?.average ?? 0) || (sb?.count ?? 0) - (sa?.count ?? 0);
      })
      .map((o) => ({ optionId: o.id }));
  }

  const rows: CellValue[][] = [
    [
      "Rank",
      "Option",
      "Points",
      "1st places",
      "Average grade",
      "Grades",
      `Ballots listing it (round ${round})`,
      "Comments",
      "Option ID",
    ],
    ...ordered.map((item, i) => {
      const s = stats.get(item.optionId);
      return [
        i + 1,
        optionTitle.get(item.optionId) ?? item.optionId,
        item.points,
        item.firstPlaces,
        s && s.count > 0 ? Math.round(s.average * 100) / 100 : undefined,
        s?.count ?? 0,
        ballots.filter((b) => b.ranking.includes(item.optionId)).length,
        s?.commentsCount ?? 0,
        item.optionId,
      ];
    }),
  ];
  const rankedBy = outcome
    ? `${outcome.strategy.id} ${outcome.strategy.version} (round ${outcome.round ?? 1}, ${outcome.at})`
    : "Average grade (no outcome yet)";
  return { rows, rankedBy };
}

/** Builds the `.xlsx` workbook for a project export bundle. */
export function createProjectWorkbook(bundle: ProjectExportV1): Uint8Array {
  const { project } = bundle;
  const title = new Map(bundle.options.map((o) => [o.id, o.title]));
  const ranking = rankingRows(bundle);
  const maxBallot = Math.max(0, ...bundle.rankings.map((r) => r.ranking.length));

  const sheets: SheetData[] = [
    {
      name: XLSX_SHEETS.project,
      widths: [26, 80],
      rows: [
        ["Field", "Value"],
        [PROJECT_FIELDS.format, PROJECT_EXPORT_FORMAT],
        [PROJECT_FIELDS.exportedAt, bundle.exportedAt],
        [PROJECT_FIELDS.title, project.title],
        [PROJECT_FIELDS.description, project.description],
        [PROJECT_FIELDS.owner, project.owner],
        [PROJECT_FIELDS.createdAt, project.createdAt],
        [PROJECT_FIELDS.votingState, project.voting.state],
        [PROJECT_FIELDS.votingRound, project.voting.round],
        [PROJECT_FIELDS.topN, project.voting.topN],
        [PROJECT_FIELDS.liveResults, project.voting.liveResults],
        [PROJECT_FIELDS.rankedBy, ranking.rankedBy],
      ],
    },
    {
      name: XLSX_SHEETS.ranking,
      widths: [6, 40, 8, 10, 14, 8, 22, 10, 28],
      rows: ranking.rows,
    },
    {
      name: XLSX_SHEETS.options,
      widths: [28, 7, 9, 36, 60, 16, 20, 40, 40, 7, 40, 24, 24],
      rows: [
        [
          "ID",
          "Order",
          "Status",
          "Title",
          "Description",
          "Category",
          "Tags",
          "Pros",
          "Cons",
          "Effort",
          "Links",
          "Added at",
          "Added by",
        ],
        ...bundle.options.map((o) => [
          o.id,
          o.order,
          o.status,
          o.title,
          o.description,
          o.category,
          lines(o.tags),
          lines(o.pros),
          lines(o.cons),
          o.effort,
          lines((o.links ?? []).map((l) => (l.title ? `${l.title} | ${l.url}` : l.url))),
          o.at,
          o.by,
        ]),
      ],
    },
    {
      name: XLSX_SHEETS.grades,
      widths: [28, 28, 36, 7, 28, 20, 24],
      rows: [
        ["ID", "Option ID", "Option", "Value", "By", "By name", "At"],
        ...bundle.grades.map((g) => [
          g.id,
          g.optionId,
          title.get(g.optionId),
          g.value,
          g.by,
          g.byName,
          g.at,
        ]),
      ],
    },
    {
      name: XLSX_SHEETS.ballots,
      widths: [28, 7, 28, 20, 24, 30, ...Array(maxBallot).fill(30)],
      rows: [
        [
          "ID",
          "Round",
          "By",
          "By name",
          "At",
          "Ranking (option IDs)",
          ...Array.from({ length: maxBallot }, (_, i) => `Choice ${i + 1}`),
        ],
        ...bundle.rankings.map((r) => [
          r.id,
          r.round,
          r.by,
          r.byName,
          r.at,
          lines(r.ranking),
          ...r.ranking.map((id) => title.get(id) ?? id),
        ]),
      ],
    },
    {
      name: XLSX_SHEETS.comments,
      widths: [28, 28, 36, 60, 28, 20, 24, 28, 8],
      rows: [
        ["ID", "Option ID", "Option", "Body", "By", "By name", "At", "Replaces", "Hidden"],
        ...bundle.comments.map((c) => [
          c.id,
          c.optionId,
          title.get(c.optionId),
          c.body,
          c.by,
          c.byName,
          c.at,
          c.replaces,
          c.hidden,
        ]),
      ],
    },
    {
      name: XLSX_SHEETS.outcomes,
      widths: [28, 7, 24, 34, 10, 28, 36, 14, 34, 28, 60, 60],
      rows: withJsonRecords(
        [
          "ID",
          "Round",
          "At",
          "Strategy",
          "Strategy version",
          "Winner ID",
          "Winner",
          "Tie-break",
          "Seed",
          "Triggered by",
          "Explanation",
        ],
        bundle.outcomes,
        (o) => [
          o.id,
          o.round,
          o.at,
          o.strategy.id,
          o.strategy.version,
          o.result.winner,
          title.get(o.result.winner),
          o.tieBreak,
          o.seed,
          o.triggeredBy,
          o.result.explanation,
        ]
      ),
    },
    {
      name: XLSX_SHEETS.contributions,
      widths: [28, 24, 28, 12, 28, 12, 12, 60, 60],
      rows: withJsonRecords(
        ["ID", "At", "By", "Target kind", "Target ID", "Type", "Review status", "Body"],
        bundle.contributions,
        (c) => [
          c.id,
          c.at,
          c.by,
          c.targetKind,
          c.targetId,
          c.type,
          c.reviewStatus,
          c.body.length > MAX_CELL_CHARS ? `${c.body.slice(0, MAX_CELL_CHARS - 1)}…` : c.body,
        ]
      ),
    },
  ];
  return writeWorkbook(sheets);
}

/** A sheet's data rows as objects keyed by lower-cased header text. */
function table(sheet: string[][] | undefined): Map<string, string>[] {
  if (!sheet || sheet.length === 0) return [];
  const header = (sheet[0] ?? []).map((h) => h.trim().toLowerCase());
  return sheet
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const record = new Map<string, string>();
      header.forEach((h, i) => {
        if (h) record.set(h, row[i] ?? "");
      });
      return record;
    });
}

const text = (row: Map<string, string>, key: string): string | undefined => {
  const v = row.get(key.toLowerCase());
  return v === undefined || v === "" ? undefined : v;
};
const num = (row: Map<string, string>, key: string): number | undefined => {
  const v = text(row, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const int = (row: Map<string, string>, key: string): number | undefined => {
  const n = num(row, key);
  return n === undefined ? undefined : Math.round(n);
};
const bool = (row: Map<string, string>, key: string): boolean | undefined => {
  const v = text(row, key)?.trim().toLowerCase();
  if (v === undefined) return undefined;
  return v === "true" || v === "1" || v === "yes";
};
const list = (row: Map<string, string>, key: string): string[] =>
  (text(row, key) ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

function jsonRecord(row: Map<string, string>, sheet: string, index: number): unknown {
  const keys = [...row.keys()]
    .filter((k) => k.startsWith(RECORD_JSON.toLowerCase()))
    .sort((a, b) => {
      const n = (k: string) => Number(k.slice(RECORD_JSON.length).trim() || "1");
      return n(a) - n(b);
    });
  const json = keys.map((k) => row.get(k) ?? "").join("");
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`${sheet} row ${index + 2}: "${RECORD_JSON}" is missing or not valid JSON`);
  }
}

function describeZodError(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return err.message;
  const [collection, index, ...rest] = issue.path;
  const sheetName =
    collection === "rankings"
      ? XLSX_SHEETS.ballots
      : typeof collection === "string" && collection in XLSX_SHEETS
        ? XLSX_SHEETS[collection as keyof typeof XLSX_SHEETS]
        : undefined;
  const where =
    sheetName && typeof index === "number"
      ? `${sheetName} row ${index + 2}${rest.length ? ` (${rest.join(".")})` : ""}`
      : issue.path.join(".") || "Workbook";
  return `${where}: ${issue.message}`;
}

/**
 * Reads a workbook written by {@link createProjectWorkbook} (possibly edited and re-saved by a
 * spreadsheet app) back into a validated `decisionator.project/v1` bundle.
 */
export function readProjectWorkbook(bytes: Uint8Array): ProjectExportV1 {
  const sheets = readWorkbook(bytes);
  const projectSheet = sheets.get(XLSX_SHEETS.project);
  const optionsSheet = sheets.get(XLSX_SHEETS.options);
  if (!projectSheet || !optionsSheet) {
    throw new Error(
      `Not a Deci project workbook: expected "${XLSX_SHEETS.project}" and "${XLSX_SHEETS.options}" sheets`
    );
  }

  const fields = new Map<string, string>();
  for (const row of projectSheet.slice(1)) {
    const key = row[0]?.trim().toLowerCase();
    if (key) fields.set(key, row[1] ?? "");
  }
  const field = (name: string) => {
    const v = fields.get(name.toLowerCase());
    return v === undefined || v === "" ? undefined : v;
  };
  const format = field(PROJECT_FIELDS.format);
  if (format !== undefined && format !== PROJECT_EXPORT_FORMAT) {
    throw new Error(`Unsupported project format "${format}"`);
  }

  const options: Partial<Option>[] = table(optionsSheet).map((r, i) => ({
    id: text(r, "ID") ?? `opt_sheet_${i + 1}`,
    order: int(r, "Order"),
    status: text(r, "Status") as Option["status"] | undefined,
    title: text(r, "Title"),
    description: text(r, "Description") ?? "",
    category: text(r, "Category"),
    tags: list(r, "Tags"),
    pros: list(r, "Pros"),
    cons: list(r, "Cons"),
    effort: text(r, "Effort") as Option["effort"] | undefined,
    links: list(r, "Links").map((line) => {
      const cut = line.lastIndexOf(" | ");
      return cut >= 0
        ? { title: line.slice(0, cut).trim(), url: line.slice(cut + 3).trim() }
        : { url: line };
    }),
    at: text(r, "Added at"),
    by: text(r, "Added by"),
  }));

  // Ballots may name options by ID or, when edited by hand, by title in the Choice columns.
  const idByTitle = new Map<string, string>();
  for (const o of options) {
    if (o.id && o.title) idByTitle.set(o.title.trim().toLowerCase(), o.id);
  }
  const ballotRanking = (r: Map<string, string>) => {
    const ids = list(r, "Ranking (option IDs)");
    if (ids.length) return ids;
    const choices: string[] = [];
    for (let i = 1; r.has(`choice ${i}`); i++) {
      const t = text(r, `Choice ${i}`)?.trim();
      if (t) choices.push(idByTitle.get(t.toLowerCase()) ?? t);
    }
    return choices;
  };

  const exportedAtField = field(PROJECT_FIELDS.exportedAt);
  const exportedAt =
    exportedAtField && !Number.isNaN(Date.parse(exportedAtField))
      ? new Date(exportedAtField).toISOString()
      : new Date().toISOString();
  // Rows added by hand may leave ID and time empty; both are re-assigned on restore anyway.
  const id = (r: Map<string, string>, prefix: string, i: number) =>
    text(r, "ID") ?? `${prefix}_sheet_${i + 1}`;
  const at = (r: Map<string, string>) => text(r, "At") ?? exportedAt;

  const raw = {
    format: PROJECT_EXPORT_FORMAT,
    exportedAt,
    project: {
      title: field(PROJECT_FIELDS.title),
      description: field(PROJECT_FIELDS.description) ?? "",
      owner: field(PROJECT_FIELDS.owner),
      createdAt: field(PROJECT_FIELDS.createdAt),
      voting: {
        state: field(PROJECT_FIELDS.votingState) ?? "open",
        round: Math.round(Number(field(PROJECT_FIELDS.votingRound) ?? 1)),
        topN: Math.round(Number(field(PROJECT_FIELDS.topN) ?? 3)),
        liveResults: /^(true|1|yes)$/i.test(field(PROJECT_FIELDS.liveResults) ?? "true"),
      },
    },
    options,
    grades: table(sheets.get(XLSX_SHEETS.grades)).map((r, i) => ({
      id: id(r, "grd", i),
      optionId: text(r, "Option ID"),
      value: int(r, "Value"),
      by: text(r, "By"),
      byName: text(r, "By name"),
      at: at(r),
    })),
    rankings: table(sheets.get(XLSX_SHEETS.ballots)).map((r, i) => ({
      id: id(r, "rnk", i),
      round: int(r, "Round") ?? 1,
      by: text(r, "By"),
      byName: text(r, "By name"),
      at: at(r),
      ranking: ballotRanking(r),
    })),
    comments: table(sheets.get(XLSX_SHEETS.comments)).map((r, i) => ({
      id: id(r, "cmt", i),
      optionId: text(r, "Option ID"),
      body: text(r, "Body") ?? "",
      by: text(r, "By"),
      byName: text(r, "By name"),
      at: at(r),
      replaces: text(r, "Replaces"),
      hidden: bool(r, "Hidden"),
    })),
    outcomes: table(sheets.get(XLSX_SHEETS.outcomes)).map((r, i) =>
      jsonRecord(r, XLSX_SHEETS.outcomes, i)
    ),
    contributions: table(sheets.get(XLSX_SHEETS.contributions)).map((r, i) =>
      jsonRecord(r, XLSX_SHEETS.contributions, i)
    ),
  };

  const parsed = ProjectExportV1Schema.safeParse(raw);
  if (!parsed.success) throw new Error(describeZodError(parsed.error));
  return parsed.data;
}
