import "fake-indexeddb/auto";
import type { Contribution } from "@decisionator/core";
import { fakeGoogleServer, fakeGoogleState } from "@decisionator/plugin-sdk/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleApiClient } from "../src/google-api.js";
import { WriteQueue } from "../src/queue.js";
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
      expect(rows[1]?.[5]?.startsWith("enc:v2:")).toBe(true);
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
      expect(grades[2]?.[4]?.startsWith("enc:v2:")).toBe(true);
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

  describe("properties and resets tab migration (sheet layout 2.3.0)", () => {
    const seen = {
      kind: "property" as const,
      optionId: OPT,
      plugin: "org.decisionator.option-status",
      key: "seen",
      scope: "person" as const,
      value: "seen",
    };
    const seenReset = {
      kind: "reset" as const,
      scope: "participant" as const,
      participantId: "owner@example.com",
      targets: ["properties" as const],
      plugin: "org.decisionator.option-status",
      key: "seen",
    };

    it("adds the missing properties tab on open, then appends and reads a property", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Before 2.3.0", options: [option] });
      const grid = fakeGoogleState.sheets.get(ref.id);
      grid?.tabs.delete("properties");
      grid?.tabs.delete("resets");

      const fresh = setupStore().store;
      const snap = await fresh.openProject(ref);
      expect(snap.project.formatVersion).toBe(2);
      expect(snap.properties).toEqual([]);
      expect(snap.history?.resets).toEqual([]);
      expect(grid?.tabs.get("properties")?.[0]).toEqual(["id", "at", "by", "optionId", "payload"]);
      expect(grid?.tabs.get("resets")?.[0]).toEqual(["id", "at", "by", "payload"]);

      await fresh.append(ref, [seen]);
      const raw = await client.batchGetValues(ref.id, ["properties!A:E"]);
      const rows = raw.valueRanges[0]?.values ?? [];
      expect(rows).toHaveLength(2);
      expect(JSON.parse(rows[1]?.[4] ?? "{}")).toMatchObject({
        plugin: seen.plugin,
        key: "seen",
        scope: "person",
        value: "seen",
      });

      const reread = await setupStore().store.openProject(ref);
      expect(reread.properties).toHaveLength(1);
      expect(reread.properties?.[0]).toMatchObject({
        optionId: OPT,
        by: "owner@example.com",
        value: "seen",
      });
      expect(reread.warnings).toBeUndefined();

      await fresh.append(ref, [seenReset]);
      const resetRows = (await client.batchGetValues(ref.id, ["resets!A:D"])).valueRanges[0]
        ?.values;
      expect(resetRows).toHaveLength(2);
      expect(JSON.parse(resetRows?.[1]?.[3] ?? "{}")).toMatchObject({
        scope: "participant",
        participantId: "owner@example.com",
        targets: ["properties"],
        plugin: seenReset.plugin,
        key: "seen",
      });
      const afterReset = await setupStore().store.openProject(ref);
      expect(afterReset.properties).toEqual([]);
      expect(afterReset.history?.properties.map((p) => p.value)).toEqual(["seen"]);
      expect(afterReset.history?.resets).toHaveLength(1);
    });

    it("adds only the resets tab to a project that already has properties", async () => {
      const { store } = setupStore();
      const ref = await store.createProject({ title: "Early 2.3.0", options: [option] });
      await store.append(ref, [seen]);
      const grid = fakeGoogleState.sheets.get(ref.id);
      grid?.tabs.delete("resets");

      const snap = await setupStore().store.openProject(ref);
      expect(snap.properties?.map((p) => p.value)).toEqual(["seen"]);
      expect(grid?.tabs.get("resets")?.[0]).toEqual(["id", "at", "by", "payload"]);
      expect(grid?.tabs.get("properties")).toHaveLength(2);
    });

    it("opens a project without a properties tab read-only for a viewer", async () => {
      const { store } = setupStore();
      const ref = await store.createProject({ title: "Before 2.3.0", options: [option] });
      await store.share(ref, { inviteUsers: [{ email: "viewer@example.com", role: "view" }] });
      const grid = fakeGoogleState.sheets.get(ref.id);
      grid?.tabs.delete("properties");
      grid?.tabs.delete("resets");

      const snap = await setupStore("viewer@example.com").store.openProject(ref);
      expect(snap.role).toBe("view");
      expect(snap.properties).toEqual([]);
      expect(grid?.tabs.has("properties")).toBe(false);
      expect(grid?.tabs.has("resets")).toBe(false);
    });

    it("encrypts property payloads in password mode and skips bad rows with a warning", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject(
        { title: "Protected", options: [option] },
        { password: PASSWORD }
      );
      await store.openProject(ref, { password: PASSWORD });
      await store.append(ref, [seen]);
      await client.appendValues(ref.id, "properties!A:E", [
        ["p_bad", "2026-10-07T00:00:00Z", "x@example.com", OPT, "enc:v1:broken"],
      ]);

      const raw = await client.batchGetValues(ref.id, ["properties!A:E"]);
      expect(raw.valueRanges[0]?.values?.[1]?.[4]?.startsWith("enc:v2:")).toBe(true);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.properties?.map((p) => p.value)).toEqual(["seen"]);
      expect(snap.warnings?.some((w) => w.startsWith("properties row 3:"))).toBe(true);
    });

    it("encrypts reset payloads in password mode and skips bad rows with a warning", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject(
        { title: "Protected", options: [option] },
        { password: PASSWORD }
      );
      await store.openProject(ref, { password: PASSWORD });
      await store.append(ref, [seen]);
      await store.append(ref, [seenReset]);
      await client.appendValues(ref.id, "resets!A:D", [
        ["r_bad", "2026-10-07T00:00:00Z", "x@example.com", "enc:v1:broken"],
      ]);

      const raw = await client.batchGetValues(ref.id, ["resets!A:D"]);
      expect(raw.valueRanges[0]?.values?.[1]?.[3]?.startsWith("enc:v2:")).toBe(true);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.properties).toEqual([]);
      expect(snap.history?.resets).toHaveLength(1);
      expect(snap.warnings?.some((w) => w.startsWith("resets row 3:"))).toBe(true);
    });
  });

  describe("createProject with a password", () => {
    it("names the Drive file neutrally instead of with the plaintext title", async () => {
      const { store } = setupStore();
      const ref = await store.createProject(
        { title: "Layoffs shortlist", options: [option] },
        { password: PASSWORD }
      );
      const name = fakeGoogleState.files.get(ref.id)?.name ?? "";
      expect(name).toBe("Deci project (protected)");
      expect(name).not.toContain("Layoffs");
    });
  });

  describe("updateOptions with a corrupted row", () => {
    const opt = (id: string, title: string, order: number) => ({ ...option, id, title, order });

    it("updates rows in place and never rewrites a row it could not decode", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({
        title: "Rows",
        options: [opt("a", "A", 1), opt("b", "B", 2), opt("c", "C", 3)],
      });
      // A direct edit breaks option b (sheet row 3).
      const grid = fakeGoogleState.sheets.get(ref.id);
      const bRow = grid?.tabs.get("options")?.[2];
      if (bRow) bRow[5] = "{ broken";

      await store.updateOptions(ref, [
        { op: "update", option: opt("a", "A2", 1) },
        { op: "remove", id: "c" },
        { op: "add", option: opt("d", "D", 4) },
      ]);

      const rows = (await client.batchGetValues(ref.id, ["options!A:F"])).valueRanges[0]?.values;
      expect(rows?.map((r) => r[0])).toEqual(["id", "a", "b", "c", "d"]);
      expect(rows?.[2]?.[5]).toBe("{ broken");
      expect(rows?.[3]?.[2]).toBe("removed");

      const snap = await store.openProject(ref);
      expect(snap.options.map((o) => [o.id, o.title, o.status])).toEqual([
        ["a", "A2", "active"],
        ["c", "C", "removed"],
        ["d", "D", "active"],
      ]);
    });
  });

  describe("append authorship", () => {
    async function sharedProject() {
      const { store } = setupStore();
      const ref = await store.createProject({ title: "Shared", options: [option] });
      await store.share(ref, {
        inviteUsers: [{ email: "contributor@example.com", role: "contribute" }],
      });
      return ref;
    }

    it("stamps a contribution's by and at from the signed-in user", async () => {
      const ref = await sharedProject();
      const { store, client } = setupStore("contributor@example.com");
      await store.append(ref, [
        { kind: "contribution", contribution: { ...contribution, at: "2000-01-01T00:00:00.000Z" } },
      ]);

      const rows = (await client.batchGetValues(ref.id, ["contributions!A:F"])).valueRanges[0]
        ?.values;
      expect(rows?.[1]?.[2]).toBe("contributor@example.com");
      expect(rows?.[1]?.[1]).not.toBe("2000-01-01T00:00:00.000Z");
    });

    it("refuses outcomes from a non-owner and writes nothing", async () => {
      const ref = await sharedProject();
      const { store } = setupStore("contributor@example.com");
      const outcome = {
        strategy: { id: "org.decisionator.strategy.owner-pick", version: "1.0.0" },
        settings: {},
        inputs: { options: [{ id: OPT, title: "Option" }] },
        result: { winner: OPT, order: [{ optionId: OPT }] },
        tieBreak: "none" as const,
        triggeredBy: "contributor@example.com",
        at: "2026-10-06T00:00:00Z",
      };
      await expect(store.append(ref, [{ kind: "outcome", outcome }])).rejects.toThrow(
        /^PERMISSION_DENIED/
      );
      const snap = await setupStore().store.openProject(ref);
      expect(snap.outcomes).toEqual([]);
    });
  });

  describe("duplicate rows", () => {
    it("counts a row appended twice (two tabs flushing the same queue) once", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Dupes", options: [option] });
      await store.append(ref, [
        { kind: "grade", optionId: OPT, value: 4 },
        { kind: "comment", optionId: OPT, body: "Once" },
      ]);
      const raw = await client.batchGetValues(ref.id, ["grades!A:E", "comments!A:E"]);
      const grade = raw.valueRanges[0]?.values?.[1] ?? [];
      const comment = raw.valueRanges[1]?.values?.[1] ?? [];
      await client.appendValues(ref.id, "grades!A:E", [grade]);
      await client.appendValues(ref.id, "comments!A:E", [comment]);

      const snap = await store.openProject(ref);
      expect(snap.grades).toHaveLength(1);
      expect(snap.history?.grades ?? []).toHaveLength(0);
      expect(snap.comments.map((c) => c.body)).toEqual(["Once"]);
    });
  });

  describe("watch", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("reads the whole project only when the Drive version changed", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Watched", options: [option] });
      const getFile = vi.spyOn(client, "getFile");
      const batchGet = vi.spyOn(client, "batchGetValues");
      const onChange = vi.fn();

      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const stop = store.watch(ref, onChange);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getFile).toHaveBeenCalled();
      expect(batchGet).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();

      await client.appendValues(ref.id, "grades!A:E", [
        ["g_x", "2026-10-06T00:00:00Z", "x@example.com", OPT, JSON.stringify({ value: 2 })],
      ]);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      stop();
    });

    it("does not poll while the tab is hidden", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Hidden", options: [option] });
      const getFile = vi.spyOn(client, "getFile");
      vi.stubGlobal("document", { visibilityState: "hidden", hidden: true });

      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const stop = store.watch(ref, vi.fn());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getFile).not.toHaveBeenCalled();
      stop();
    });
  });

  describe("append with a permanently failing project in the queue", () => {
    it("still sends this project's rows and reports the failure separately", async () => {
      fakeGoogleState.setCurrentUser("owner@example.com");
      const auth = new GoogleAuthService({ clientId: "test-client" });
      auth.setTokenInMemory("fake-token-123");
      const client = new GoogleApiClient(() => auth.getValidToken());
      const queue = new WriteQueue(`test-store-park-${Date.now()}`);
      const store = new GoogleSheetsProjectStore(auth, client, queue);
      // Left over from a project that was deleted while offline.
      await queue.enqueue("sheet_deleted", "grades", [
        "g_old",
        "now",
        "owner@example.com",
        OPT,
        "{}",
      ]);

      const ok = await store.createProject({ title: "Ok", options: [option] });
      const res = await store.append(ok, [{ kind: "grade", optionId: OPT, value: 3 }]);
      expect(res).toMatchObject({ queued: 0, sent: 1 });
      const snap = await store.openProject(ok);
      expect(snap.grades.map((g) => g.value)).toEqual([3]);
      expect((await queue.getFailed("sheet_deleted")).map((i) => i.row[0])).toEqual(["g_old"]);

      // A later flush triggered without an append does not retry the parked rows.
      const again = await store.flushPending();
      expect(again).toMatchObject({ queued: 0, sent: 0 });
    });
  });
});
