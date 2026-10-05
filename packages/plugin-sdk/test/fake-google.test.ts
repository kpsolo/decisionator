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
});
