import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fakeGoogleServer, fakeGoogleState } from "../testing/fake-google/index.js";

describe("fakeGoogleBackend", () => {
  beforeAll(() => fakeGoogleServer.listen());
  afterEach(() => {
    fakeGoogleServer.resetHandlers();
    fakeGoogleState.reset();
  });
  afterAll(() => fakeGoogleServer.close());

  it("identifies current user via Drive about.get", async () => {
    const res = await fetch("https://www.googleapis.com/drive/v3/about");
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.user.emailAddress).toBe("alice@example.com");
  });

  it("injects 429 rate limit error", async () => {
    fakeGoogleState.injectRateLimit(429);
    const res = await fetch("https://www.googleapis.com/drive/v3/about");
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error.code).toBe(429);

    // Subsequent request succeeds
    const nextRes = await fetch("https://www.googleapis.com/drive/v3/about");
    expect(nextRes.ok).toBe(true);
  });

  it("handles drive file creation, list with appProperties, and trash", async () => {
    // create file
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Doc",
        appProperties: { decisionator: "project", formatVersion: "1" },
      }),
    });
    expect(createRes.ok).toBe(true);
    const file = await createRes.json();
    expect(file.id).toBeDefined();

    // list file with appProperties filter
    const listRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?q=appProperties+has+{+key='decisionator'+and+value='1'+}"
    );
    // shouldn't match formatVersion=1 on decisionator key
    const listData1 = await listRes.json();
    expect(listData1.files.length).toBe(0);

    const listRes2 = await fetch(
      "https://www.googleapis.com/drive/v3/files?q=appProperties+has+{+key='decisionator'+and+value='project'+}"
    );
    const listData2 = await listRes2.json();
    expect(listData2.files.length).toBe(1);
    expect(listData2.files[0].id).toBe(file.id);

    // trash file
    const trashRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    expect(trashRes.ok).toBe(true);

    // now files.get should return 404
    const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`);
    expect(getRes.status).toBe(404);
  });

  it("handles spreadsheets create, values append and batchGet", async () => {
    const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { title: "Decision Project" },
        sheets: [{ properties: { title: "meta" } }, { properties: { title: "grades" } }],
      }),
    });
    expect(createRes.ok).toBe(true);
    const sheet = await createRes.json();
    const id = sheet.spreadsheetId;

    // Append to grades
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/grades!A:E:append`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: [["id1", "2026-10-05T00:00:00Z", "alice@example.com", "opt1", '{"value":5}']],
        }),
      }
    );
    expect(appendRes.ok).toBe(true);

    // batchGet
    const getRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?ranges=grades!A:E`
    );
    expect(getRes.ok).toBe(true);
    const data = await getRes.json();
    expect(data.valueRanges[0].values.length).toBe(1);
    expect(data.valueRanges[0].values[0][3]).toBe("opt1");
  });

  describe("Sheets A1 ranges and tabs", () => {
    async function createSheet(rows: string[][]): Promise<string> {
      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: { title: "Ranges" },
          sheets: [{ properties: { title: "meta" } }],
        }),
      });
      const { spreadsheetId } = await createRes.json();
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/meta!A:B:append`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: rows }),
        }
      );
      return spreadsheetId;
    }

    function batchUpdate(id: string, data: { range: string; values: string[][] }[]) {
      return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valueInputOption: "RAW", data }),
      });
    }

    async function readMeta(id: string): Promise<string[][]> {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?ranges=meta!A:B`
      );
      return (await res.json()).valueRanges[0].values;
    }

    const META = [
      ["key", "value"],
      ["formatVersion", "1"],
      ["title", "Old"],
    ];

    it("writes a single cell and leaves the rest of the tab alone", async () => {
      const id = await createSheet(META);
      const res = await batchUpdate(id, [{ range: "meta!B3", values: [["New"]] }]);
      expect(res.ok).toBe(true);
      expect(await readMeta(id)).toEqual([
        ["key", "value"],
        ["formatVersion", "1"],
        ["title", "New"],
      ]);
    });

    it("writes from the top-left of a column range without clearing later rows", async () => {
      const id = await createSheet(META);
      await batchUpdate(id, [{ range: "'meta'!A:B", values: [["k", "v"]] }]);
      expect(await readMeta(id)).toEqual([
        ["k", "v"],
        ["formatVersion", "1"],
        ["title", "Old"],
      ]);
    });

    it("writes below the data and pads the rows in between", async () => {
      const id = await createSheet(META);
      await batchUpdate(id, [{ range: "meta!A5:B5", values: [["owner", "a@example.com"]] }]);
      const rows = await readMeta(id);
      expect(rows).toHaveLength(5);
      expect(rows[3]).toEqual([]);
      expect(rows[4]).toEqual(["owner", "a@example.com"]);
    });

    it("rejects values that do not fit the range", async () => {
      const id = await createSheet(META);
      const res = await batchUpdate(id, [{ range: "meta!B2", values: [["2", "extra"]] }]);
      expect(res.status).toBe(400);
      expect(await readMeta(id)).toEqual(META);
    });

    it("rejects writes and appends to a tab that does not exist", async () => {
      const id = await createSheet(META);
      const res = await batchUpdate(id, [
        { range: "meta!B3", values: [["New"]] },
        { range: "missing!A1", values: [["x"]] },
      ]);
      expect(res.status).toBe(400);
      expect(await readMeta(id)).toEqual(META);

      const append = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/missing!A:B:append`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: [["x"]] }),
        }
      );
      expect(append.status).toBe(400);
    });

    it("reads only the requested range and trims empty cells", async () => {
      const id = await createSheet([...META, [], ["owner", ""]]);
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?ranges=meta!A2:A3&ranges=meta!B3&ranges=meta!A:B&ranges=meta!C:C`
      );
      const { valueRanges } = await res.json();
      expect(valueRanges[0].values).toEqual([["formatVersion"], ["title"]]);
      expect(valueRanges[1].values).toEqual([["Old"]]);
      expect(valueRanges[2].values).toEqual([...META, [], ["owner"]]);
      expect(valueRanges[3].values).toBeUndefined();
    });

    it("rejects a read of a tab that does not exist", async () => {
      const id = await createSheet(META);
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?ranges=meta!A:B&ranges=missing!A:B`
      );
      expect(res.status).toBe(400);
    });

    it("lists tabs and adds one with spreadsheets.batchUpdate addSheet", async () => {
      const id = await createSheet(META);
      const addSheet = () =>
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "extra" } } }] }),
        });
      expect((await addSheet()).ok).toBe(true);
      expect((await addSheet()).status).toBe(400);

      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`
      );
      const sheet = await res.json();
      expect(
        sheet.sheets.map((s: { properties: { title: string } }) => s.properties.title)
      ).toEqual(["meta", "extra"]);
      expect((await batchUpdate(id, [{ range: "extra!A1", values: [["x"]] }])).ok).toBe(true);
    });
  });
});
