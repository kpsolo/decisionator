import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  type ProjectExportV1,
  ProjectExportV1Schema,
  XLSX_SHEETS,
  createProjectExport,
  createProjectWorkbook,
  latestOutcome,
  looksLikeXlsx,
  readProjectWorkbook,
  readWorkbook,
  writeWorkbook,
} from "../../src/index.js";

const AT = "2026-10-01T10:00:00.000Z";

function sampleBundle(): ProjectExportV1 {
  return createProjectExport({
    project: {
      title: 'Team offsite <location> & "venue"',
      description: "Where should we go?\nSecond line.",
      voting: { state: "closed", round: 2, topN: 3, liveResults: false },
    },
    options: [
      {
        id: "opt_lis",
        order: 1,
        title: "Lisbon",
        description: "Mild weather",
        category: "Europe",
        tags: ["sun", "city"],
        pros: ["Direct flights", "Food"],
        cons: ["Hilly"],
        effort: "M",
        links: [{ title: "Guide", url: "https://example.com/lisbon" }, { url: "https://x.io" }],
        at: AT,
        by: "owner@device",
      },
      { id: "opt_alp", order: 2, title: "Alps lodge", status: "removed" },
      { id: "opt_bcn", order: 3, title: "Barcelona" },
    ],
    grades: [
      { id: "g1", at: AT, by: "owner@device", optionId: "opt_lis", value: 5 },
      { id: "g2", at: AT, by: "guest:1", byName: "Ana", optionId: "opt_bcn", value: 3 },
    ],
    comments: [
      { id: "c1", at: AT, by: "owner@device", optionId: "opt_lis", body: "**Strong** pick" },
      {
        id: "c2",
        at: AT,
        by: "owner@device",
        optionId: "opt_lis",
        body: "",
        replaces: "c1",
        hidden: true,
      },
    ],
    rankings: [
      { id: "r1", at: AT, by: "owner@device", round: 1, ranking: ["opt_lis", "opt_bcn"] },
      {
        id: "r2",
        at: AT,
        by: "guest:1",
        byName: "Ana",
        round: 2,
        ranking: ["opt_bcn", "opt_lis", "opt_alp"],
      },
    ],
    outcomes: [
      {
        id: "out1",
        round: 2,
        strategy: { id: "org.decisionator.strategy.borda", version: "0.1.0" },
        settings: { topN: 3 },
        inputs: {
          options: [
            { id: "opt_lis", title: "Lisbon" },
            { id: "opt_bcn", title: "Barcelona" },
          ],
          ballots: [{ by: "guest:1", ranking: ["opt_bcn", "opt_lis"] }],
        },
        result: {
          winner: "opt_bcn",
          order: [
            { optionId: "opt_bcn", points: 3, firstPlaces: 1 },
            { optionId: "opt_lis", points: 2, firstPlaces: 0 },
          ],
          explanation: "Borda count",
        },
        tieBreak: "seeded-random",
        seed: "0123456789abcdef0123456789abcdef",
        triggeredBy: "owner@device",
        at: AT,
      },
    ],
    contributions: [
      {
        id: "k1",
        at: AT,
        by: "agent:1",
        targetKind: "option",
        targetId: "opt_lis",
        type: "pros_cons",
        body: "Research notes",
        pros: ["Cheap"],
        author: { kind: "agent", agentName: "Claude" },
        reviewStatus: "accepted",
      },
    ],
    properties: [
      {
        id: "p1",
        at: AT,
        by: "owner@device",
        optionId: "opt_lis",
        plugin: "org.example.budget",
        key: "cost",
        scope: "shared",
        value: 1200,
      },
      {
        id: "p2",
        at: AT,
        by: "owner@device",
        optionId: "opt_bcn",
        plugin: "org.example.budget",
        key: "approved",
        scope: "shared",
        value: false,
      },
      {
        id: "p3",
        at: AT,
        by: "guest:ana",
        byName: "Ana",
        optionId: "opt_lis",
        plugin: "org.decisionator.option-status",
        key: "seen",
        scope: "person",
        value: "seen_auto",
      },
      {
        id: "p4",
        at: AT,
        by: "guest:ana",
        byName: "Ana",
        optionId: "opt_bcn",
        plugin: "org.decisionator.option-status",
        key: "seen",
        scope: "person",
        value: null,
      },
      {
        id: "p5",
        at: AT,
        by: "owner@device",
        optionId: "opt_bcn",
        plugin: "org.example.budget",
        key: "note",
        scope: "shared",
        value: "42",
      },
    ],
  });
}

describe("project workbook (.xlsx)", () => {
  it("round-trips every field of a project bundle", () => {
    const bundle = sampleBundle();
    const bytes = createProjectWorkbook(bundle);
    expect(looksLikeXlsx(bytes)).toBe(true);

    const restored = readProjectWorkbook(bytes);
    expect(restored).toEqual(bundle);
  });

  it("writes readable sheets: project, ranking, options, votes", () => {
    const sheets = readWorkbook(createProjectWorkbook(sampleBundle()));
    expect([...sheets.keys()]).toEqual(Object.values(XLSX_SHEETS));

    const ranking = sheets.get(XLSX_SHEETS.ranking) ?? [];
    expect(ranking[0]?.slice(0, 4)).toEqual(["Rank", "Option", "Points", "1st places"]);
    // Latest outcome order first, then options it did not rank.
    expect(ranking.slice(1).map((r) => r[1])).toEqual(["Barcelona", "Lisbon", "Alps lodge"]);
    expect(ranking[1]?.[2]).toBe("3");

    const ballots = sheets.get(XLSX_SHEETS.ballots) ?? [];
    expect(ballots[2]?.slice(-3)).toEqual(["Barcelona", "Lisbon", "Alps lodge"]);
  });

  it("splits JSON records longer than one cell over several columns", () => {
    const bundle = sampleBundle();
    const first = bundle.outcomes[0];
    if (!first) throw new Error("fixture");
    const ballots = Array.from({ length: 2000 }, (_, i) => ({
      by: `voter-${i}@example.com`,
      ranking: ["opt_bcn", "opt_lis"],
    }));
    bundle.outcomes = [{ ...first, inputs: { ...first.inputs, ballots } }];

    const bytes = createProjectWorkbook(bundle);
    const header = readWorkbook(bytes).get(XLSX_SHEETS.outcomes)?.[0] ?? [];
    expect(header).toContain("Record (JSON) 2");
    expect(readProjectWorkbook(bytes).outcomes[0]?.inputs.ballots).toHaveLength(2000);
  });

  it("accepts a re-saved workbook: shared strings, reordered columns, titles in choices", () => {
    // Shape produced by Excel / Google Sheets: shared strings, explicit cell refs.
    const shared = [
      "Field",
      "Value",
      "Title",
      "Re-saved",
      "ID",
      "Title",
      "o1",
      "First",
      "o2",
      "Second",
    ];
    const sst = `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
    const s = (i: number, ref: string) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
    const project = `<worksheet><sheetData><row r="1">${s(0, "A1")}${s(1, "B1")}</row><row r="2">${s(2, "A2")}${s(3, "B2")}</row></sheetData></worksheet>`;
    // Columns swapped: Title before ID.
    const options = `<worksheet><sheetData><row r="1">${s(5, "A1")}${s(4, "B1")}</row><row r="2">${s(7, "A2")}${s(6, "B2")}</row><row r="3">${s(9, "A3")}${s(8, "B3")}</row></sheetData></worksheet>`;
    const ballots = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>By</t></is></c><c r="B1" t="inlineStr"><is><t>Choice 1</t></is></c><c r="C1" t="inlineStr"><is><r><t>Choice </t></r><r><t>2</t></r></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>me</t></is></c><c r="B2" t="inlineStr"><is><t>Second</t></is></c><c r="C2" t="inlineStr"><is><t>First</t></is></c></row></sheetData></worksheet>`;
    const rel = (i: number) =>
      `<Relationship Id="rId${i}" Type="worksheet" Target="/xl/worksheets/s${i}.xml"/>`;
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook><sheets><sheet name="Project" sheetId="1" r:id="rId1"/><sheet name="Options" sheetId="2" r:id="rId2"/><sheet name="Ballots" sheetId="3" r:id="rId3"/></sheets></workbook>`
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships>${rel(1)}${rel(2)}${rel(3)}</Relationships>`
      ),
      "xl/sharedStrings.xml": strToU8(sst),
      "xl/worksheets/s1.xml": strToU8(project),
      "xl/worksheets/s2.xml": strToU8(options),
      "xl/worksheets/s3.xml": strToU8(ballots),
    });

    const restored = readProjectWorkbook(bytes);
    expect(restored.project.title).toBe("Re-saved");
    expect(restored.options.map((o) => [o.id, o.title])).toEqual([
      ["o1", "First"],
      ["o2", "Second"],
    ]);
    expect(restored.rankings[0]?.ranking).toEqual(["o2", "o1"]);
    expect(ProjectExportV1Schema.safeParse(restored).success).toBe(true);
  });

  it("reports which sheet row is invalid", () => {
    const bundle = sampleBundle();
    const bytes = createProjectWorkbook(bundle);
    const files = unzipSync(bytes);
    // Sheet 4 is Grades; turn the first grade (5) into 9.
    const path = "xl/worksheets/sheet4.xml";
    files[path] = strToU8(strFromU8(files[path] as Uint8Array).replace("<v>5</v>", "<v>9</v>"));
    expect(() => readProjectWorkbook(zipSync(files))).toThrow(/Grades row 2 \(value\)/);
  });

  it("rejects files that are not project workbooks", () => {
    expect(() => readProjectWorkbook(strToU8("not a zip"))).toThrow(/not a valid \.xlsx/);
    const other = writeWorkbook([{ name: "Sheet1", rows: [["a"]] }]);
    expect(() => readProjectWorkbook(other)).toThrow(/Not a Deci project workbook/);
  });

  it("keeps shared and person property values with their JSON types", () => {
    const bundle = sampleBundle();
    const fromXlsx = readProjectWorkbook(createProjectWorkbook(bundle));
    const fromJson = ProjectExportV1Schema.parse(JSON.parse(JSON.stringify(bundle)));
    for (const restored of [fromXlsx, fromJson]) {
      expect(restored.properties).toEqual(bundle.properties);
      expect(restored.properties.map((p) => p.value)).toEqual([
        1200,
        false,
        "seen_auto",
        null,
        "42",
      ]);
    }

    const sheet = readWorkbook(createProjectWorkbook(bundle)).get(XLSX_SHEETS.properties) ?? [];
    expect(sheet[0]?.slice(0, 9)).toEqual([
      "Option",
      "Plugin",
      "Key",
      "Scope",
      "Value",
      "By",
      "By name",
      "At",
      "Record (JSON)",
    ]);
    expect(sheet[3]?.slice(0, 7)).toEqual([
      "Lisbon",
      "org.decisionator.option-status",
      "seen",
      "person",
      "seen_auto",
      "guest:ana",
      "Ana",
    ]);
  });

  it("reads hand-added Properties rows without a JSON record", () => {
    const bundle = sampleBundle();
    bundle.properties = [];
    const sheets = readWorkbook(createProjectWorkbook(bundle));
    const rows = (name: string) => sheets.get(name) ?? [];
    const edited = writeWorkbook([
      ...[...sheets.keys()]
        .filter((name) => name !== XLSX_SHEETS.properties)
        .map((name) => ({ name, rows: rows(name) })),
      {
        name: XLSX_SHEETS.properties,
        rows: [
          ["Option", "Plugin", "Key", "Scope", "Value", "By"],
          ["Lisbon", "org.example.budget", "cost", "shared", 900, "owner@device"],
          ["opt_bcn", "org.example.budget", "approved", "shared", true, "owner@device"],
          ["Barcelona", "org.example.budget", "note", "shared", "cheap", "owner@device"],
        ],
      },
    ]);
    const restored = readProjectWorkbook(edited);
    expect(restored.properties.map((p) => [p.optionId, p.key, p.value])).toEqual([
      ["opt_lis", "cost", 900],
      ["opt_bcn", "approved", true],
      ["opt_bcn", "note", "cheap"],
    ]);
  });

  it("older files without properties still load", () => {
    const { properties: _omit, ...legacy } = sampleBundle();
    expect(ProjectExportV1Schema.parse(legacy).properties).toEqual([]);

    const sheets = readWorkbook(createProjectWorkbook(sampleBundle()));
    const old = writeWorkbook(
      [...sheets.keys()]
        .filter((name) => name !== XLSX_SHEETS.properties)
        .map((name) => ({ name, rows: sheets.get(name) ?? [] }))
    );
    const restored = readProjectWorkbook(old);
    expect(restored.properties).toEqual([]);
    expect(restored.options).toHaveLength(3);
  });

  it("older JSON bundles without contributions still parse", () => {
    const { contributions: _omit, ...legacy } = sampleBundle();
    expect(ProjectExportV1Schema.parse(legacy).contributions).toEqual([]);
  });
});

describe("latestOutcome", () => {
  const o = (id: string, round: number, at: string) => ({ id, round, at });

  it("picks the newest outcome of the round, else of the project", () => {
    const list = [o("a", 1, "2026-01-01"), o("b", 1, "2026-01-03"), o("c", 2, "2026-01-02")];
    expect(latestOutcome(list, 1)?.id).toBe("b");
    expect(latestOutcome(list, 2)?.id).toBe("c");
    expect(latestOutcome(list, 3)?.id).toBe("b");
    expect(latestOutcome([], 1)).toBeUndefined();
  });

  it("prefers the later-recorded outcome on equal times", () => {
    expect(latestOutcome([o("a", 1, "t"), o("b", 1, "t")], 1)?.id).toBe("b");
  });
});
