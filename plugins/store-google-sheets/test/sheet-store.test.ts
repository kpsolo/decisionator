import "fake-indexeddb/auto";
import type { Contribution } from "@decisionator/core";
import { fakeGoogleServer, fakeGoogleState } from "@decisionator/plugin-sdk/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleApiClient } from "../src/google-api.js";
import { GoogleSheetsProjectStore } from "../src/sheet-store.js";

const PASSWORD = "correct-horse-battery-staple-123";
const OPT = "opt_1";

const option = {
  id: OPT,
  order: 1,
  status: "active" as const,
  title: "Option",
  description: "Option description",
  tags: [],
  pros: [],
  cons: [],
  links: [],
};

const contribution: Contribution = {
  id: "c_1",
  at: "2026-10-06T00:00:00.000Z",
  by: "owner@example.com",
  targetKind: "option",
  targetId: OPT,
  type: "note",
  body: "Agent research note",
  author: { kind: "agent", agentName: "researcher" },
  reviewStatus: "pending",
};

describe("GoogleSheetsProjectStore", () => {
  beforeAll(() => fakeGoogleServer.listen());
  afterEach(() => {
    fakeGoogleServer.resetHandlers();
    fakeGoogleState.reset();
  });
  afterAll(() => fakeGoogleServer.close());

  function setupStore(email = "owner@example.com") {
    fakeGoogleState.setCurrentUser(email);
    const auth = new GoogleAuthService({ clientId: "test-client" });
    auth.setTokenInMemory("fake-token-123");
    const client = new GoogleApiClient(() => auth.getValidToken());
    return { store: new GoogleSheetsProjectStore(auth, client), client };
  }

  describe("enablePassword", () => {
    it("encrypts the contributions tab so the project stays readable", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Plain", options: [option] });
      await store.append(ref, [{ kind: "contribution", contribution }]);

      await store.enablePassword(ref, PASSWORD);

      const raw = await client.batchGetValues(ref.id, ["contributions!A:F"]);
      const rows = raw.valueRanges[0]?.values ?? [];
      expect(rows).toHaveLength(2);
      expect(rows[1]?.[5]?.startsWith("enc:v1:")).toBe(true);
      expect(JSON.stringify(raw)).not.toContain("Agent research note");

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.contributions).toHaveLength(1);
      expect(snap.contributions?.[0]).toMatchObject({
        id: "c_1",
        body: "Agent research note",
        author: { kind: "agent", agentName: "researcher" },
      });
      expect(snap.options[0]?.title).toBe("Option");
    });

    it("keeps every row in place so no plaintext row is left behind", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Plain", options: [option] });
      await client.appendValues(ref.id, "grades!A:E", [
        ["g_blank", "2026-10-06T00:00:00Z", "x@example.com", OPT, ""],
        ["g_1", "2026-10-06T00:00:01Z", "y@example.com", OPT, JSON.stringify({ value: 4 })],
      ]);
      await client.batchUpdateValues(ref.id, [
        { range: "meta!A9:B9", values: [["custom", "kept"]] },
      ]);

      await store.enablePassword(ref, PASSWORD);

      const raw = await client.batchGetValues(ref.id, ["grades!A:E", "meta!A:B"]);
      const grades = raw.valueRanges[0]?.values ?? [];
      expect(grades).toHaveLength(3);
      expect(grades[1]?.[0]).toBe("g_blank");
      expect(grades[2]?.[0]).toBe("g_1");
      expect(grades[2]?.[4]?.startsWith("enc:v1:")).toBe(true);
      const meta = raw.valueRanges[1]?.values ?? [];
      expect(meta[0]).toEqual(["key", "value"]);
      expect(meta.find((r) => r[0] === "custom")?.[1]).toBe("kept");
      expect(meta.filter((r) => r[0] === "title")).toHaveLength(1);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.project.title).toBe("Plain");
      expect(snap.grades.map((g) => g.value)).toEqual([4]);
    });
  });

  describe("openProject with malformed rows", () => {
    it("skips each bad row, keeps the rest and reports tab and row", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Messy", options: [option] });
      await store.append(ref, [
        { kind: "grade", optionId: OPT, value: 5 },
        { kind: "comment", optionId: OPT, body: "Fine" },
        { kind: "ranking", ranking: [OPT] },
        { kind: "contribution", contribution },
      ]);
      // Direct edits in Google Sheets, one broken row per tab (sheet row 3 each, options row 3).
      await client.appendValues(ref.id, "options!A:F", [
        ["opt_bad", "2", "active", "", "owner@example.com", "{ not json"],
      ]);
      await client.appendValues(ref.id, "grades!A:E", [
        ["g_bad", "2026-10-06T00:00:00Z", "x@example.com", OPT, JSON.stringify({ value: 9 })],
      ]);
      await client.appendValues(ref.id, "comments!A:E", [
        ["c_bad", "2026-10-06T00:00:00Z", "x@example.com", OPT, "not json"],
      ]);
      await client.appendValues(ref.id, "rankings!A:D", [
        ["r_bad", "2026-10-06T00:00:00Z", "x@example.com", JSON.stringify({ ranking: "x" })],
      ]);
      await client.appendValues(ref.id, "outcomes!A:D", [
        ["o_bad", "2026-10-06T00:00:00Z", "owner@example.com", "{"],
      ]);
      await client.appendValues(ref.id, "contributions!A:F", [
        ["k_bad", "2026-10-06T00:00:00Z", "x@example.com", "project", "", "{}"],
      ]);

      const snap = await store.openProject(ref);
      expect(snap.options.map((o) => o.id)).toEqual([OPT]);
      expect(snap.grades.map((g) => g.value)).toEqual([5]);
      expect(snap.comments.map((c) => c.body)).toEqual(["Fine"]);
      expect(snap.rankings.map((r) => r.ranking)).toEqual([[OPT]]);
      expect(snap.outcomes).toEqual([]);
      expect(snap.contributions?.map((c) => c.id)).toEqual(["c_1"]);

      const warnings = snap.warnings ?? [];
      expect(warnings).toHaveLength(6);
      for (const tab of ["options", "grades", "comments", "rankings", "contributions"]) {
        expect(warnings.some((w) => w.startsWith(`${tab} row 3:`))).toBe(true);
      }
      expect(warnings.some((w) => w.startsWith("outcomes row 2:"))).toBe(true);
    });

    it("skips a row whose ciphertext was damaged in a protected project", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject(
        { title: "Secret", options: [option] },
        { password: PASSWORD }
      );
      await store.openProject(ref, { password: PASSWORD });
      await store.append(ref, [{ kind: "grade", optionId: OPT, value: 3 }]);
      await client.appendValues(ref.id, "grades!A:E", [
        ["g_bad", "2026-10-06T00:00:00Z", "x@example.com", OPT, "enc:v1:broken"],
      ]);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.grades.map((g) => g.value)).toEqual([3]);
    });

    it("falls back to the default voting settings when the meta row is broken", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Meta", options: [option] });
      await client.batchUpdateValues(ref.id, [{ range: "meta!B6", values: [["{ broken"]] }]);

      const snap = await store.openProject(ref);
      expect(snap.project.voting).toMatchObject({ state: "open", round: 1 });
      expect(snap.warnings?.some((w) => w.startsWith("meta row 6:"))).toBe(true);
    });

    it("reports no warnings for a clean project", async () => {
      const { store } = setupStore();
      const ref = await store.createProject({ title: "Clean", options: [option] });
      const snap = await store.openProject(ref);
      expect(snap.warnings).toBeUndefined();
    });
  });

  describe("append ranking without a round", () => {
    it("records it for the project's current voting round", async () => {
      const { store } = setupStore();
      const ref = await store.createProject({
        title: "Rounds",
        options: [option],
        voting: { state: "open", round: 2, topN: 3, liveResults: true },
      });

      await store.append(ref, [{ kind: "ranking", ranking: [OPT] }]);
      let snap = await store.openProject(ref);
      expect(snap.rankings.map((r) => r.round)).toEqual([2]);

      await store.updateMeta(ref, { voting: { ...snap.project.voting, round: 3 } });
      await store.append(ref, [{ kind: "ranking", ranking: [OPT] }]);
      await store.append(ref, [{ kind: "ranking", ranking: [OPT], round: 1 }]);
      snap = await store.openProject(ref);
      expect(snap.rankings.map((r) => r.round).sort()).toEqual([1, 2, 3]);
    });
  });

  describe("format v1 migration", () => {
    it("updates the formatVersion row instead of overwriting the meta header", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Legacy", options: [option] });
      const grid = fakeGoogleState.sheets.get(ref.id);
      grid?.tabs.delete("contributions");
      const meta = grid?.tabs.get("meta") ?? [];
      const versionRow = meta.find((r) => r[0] === "formatVersion");
      if (versionRow) versionRow[1] = "1";

      const snap = await store.openProject(ref);
      expect(snap.project.formatVersion).toBe(2);

      const raw = await client.batchGetValues(ref.id, ["meta!A:B", "contributions!A:F"]);
      const rows = raw.valueRanges[0]?.values ?? [];
      expect(rows[0]).toEqual(["key", "value"]);
      expect(rows.filter((r) => r[0] === "formatVersion")).toEqual([["formatVersion", "2"]]);
      expect(raw.valueRanges[1]?.values?.[0]?.[0]).toBe("id");
      expect((await store.openProject(ref)).project.formatVersion).toBe(2);
    });

    it("opens a v1 project without a contributions tab read-only for a viewer", async () => {
      const { store } = setupStore();
      const ref = await store.createProject({ title: "Legacy", options: [option] });
      await store.share(ref, { inviteUsers: [{ email: "viewer@example.com", role: "view" }] });
      const grid = fakeGoogleState.sheets.get(ref.id);
      grid?.tabs.delete("contributions");
      const versionRow = grid?.tabs.get("meta")?.find((r) => r[0] === "formatVersion");
      if (versionRow) versionRow[1] = "1";

      const snap = await setupStore("viewer@example.com").store.openProject(ref);
      expect(snap.role).toBe("view");
      expect(snap.project.formatVersion).toBe(1);
      expect(snap.contributions).toEqual([]);
      expect(snap.options.map((o) => o.id)).toEqual([OPT]);
      expect(grid?.tabs.has("contributions")).toBe(false);
    });
  });
});
