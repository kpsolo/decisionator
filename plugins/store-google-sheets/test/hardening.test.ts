import "fake-indexeddb/auto";
import { deriveKey } from "@decisionator/core";
import { fakeGoogleServer, fakeGoogleState } from "@decisionator/plugin-sdk/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleApiClient } from "../src/google-api.js";
import { decodeOptionRow } from "../src/rows.js";
import { FALLBACK_APP_URL, projectLinkUrl } from "../src/share.js";
import { GoogleSheetsProjectStore } from "../src/sheet-store.js";

const PASSWORD = "correct-horse-battery-staple-123";
const OWNER = "owner@example.com";
const OPT = "opt_1";

const option = {
  id: OPT,
  order: 1,
  status: "active" as const,
  title: "Option one",
  description: "First",
  tags: [],
  pros: [],
  cons: [],
  links: [],
};
const second = { ...option, id: "opt_2", order: 2, title: "Option two", description: "Second" };

describe("GoogleSheetsProjectStore security hardening", () => {
  beforeAll(() => fakeGoogleServer.listen());
  afterEach(() => {
    fakeGoogleServer.resetHandlers();
    fakeGoogleState.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterAll(() => fakeGoogleServer.close());

  function setupStore(email = OWNER) {
    fakeGoogleState.setCurrentUser(email);
    const auth = new GoogleAuthService({ clientId: "test-client" });
    auth.setTokenInMemory("fake-token-123");
    const client = new GoogleApiClient(() => auth.getValidToken());
    return { store: new GoogleSheetsProjectStore(auth, client), client };
  }

  /** Overwrites one meta value in place, as a collaborator editing the sheet would. */
  async function editMeta(client: GoogleApiClient, id: string, name: string, value: string) {
    const raw = await client.batchGetValues(id, ["meta!A:B"]);
    const rows = raw.valueRanges[0]?.values ?? [];
    const index = rows.findIndex((r) => r[0] === name);
    const row = index >= 0 ? index + 1 : rows.length + 1;
    await client.batchUpdateValues(id, [
      { range: `meta!A${row}:B${row}`, values: [[name, value]] },
    ]);
  }

  async function protectedProject(options = [option]) {
    const { store, client } = setupStore();
    const ref = await store.createProject({ title: "Secret", options }, { password: PASSWORD });
    await store.openProject(ref, { password: PASSWORD });
    return { store, client, ref };
  }

  describe("codec v2 (AAD) on rows", () => {
    it("does not decrypt option payloads swapped between two rows", async () => {
      const { client, ref } = await protectedProject([option, second]);
      const raw = await client.batchGetValues(ref.id, ["options!A:F"]);
      const rows = raw.valueRanges[0]?.values ?? [];
      const a = rows[1]?.[5];
      const b = rows[2]?.[5];
      if (!a || !b) throw new Error("option rows missing");
      await client.batchUpdateValues(ref.id, [
        { range: "options!F2:F2", values: [[b]] },
        { range: "options!F3:F3", values: [[a]] },
      ]);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.options).toEqual([]);
      expect(snap.warnings?.filter((w) => w.startsWith("options row"))).toHaveLength(2);
    });

    it("does not decrypt a grade whose option or author column was edited", async () => {
      const { store, client, ref } = await protectedProject([option, second]);
      await store.append(ref, [{ kind: "grade", optionId: OPT, value: 5 }]);
      await client.batchUpdateValues(ref.id, [{ range: "grades!D2:D2", values: [["opt_2"]] }]);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.grades).toEqual([]);
      expect(snap.warnings?.some((w) => w.startsWith("grades row 2:"))).toBe(true);
    });

    it("still reads rows sealed by the legacy v1 codec (no AAD)", async () => {
      const { client, ref } = await protectedProject();
      const meta = new Map(
        ((await client.batchGetValues(ref.id, ["meta!A:B"])).valueRanges[0]?.values ?? []).map(
          (r) => [r[0], r[1]] as const
        )
      );
      const key = await deriveKey(
        PASSWORD,
        new Uint8Array(Buffer.from(meta.get("salt") ?? "", "base64")),
        600_000
      );
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(JSON.stringify({ value: 4 }))
      );
      const legacy = `enc:v1:${Buffer.from(iv).toString("base64")}:${Buffer.from(ct).toString("base64")}`;
      await client.appendValues(ref.id, "grades!A:E", [
        ["g_legacy", "2026-10-06T00:00:00Z", "x@example.com", OPT, legacy],
      ]);

      const snap = await setupStore().store.openProject(ref, { password: PASSWORD });
      expect(snap.grades.map((g) => g.value)).toEqual([4]);
    });
  });

  describe("protection downgrade (F4)", () => {
    it("refuses to treat an unlocked project as plain after the meta flag is flipped", async () => {
      const { store, client, ref } = await protectedProject();
      await editMeta(client, ref.id, "protected", "false");

      await expect(store.openProject(ref)).rejects.toThrow(/PROTECTION_DOWNGRADE/);
      await expect(store.updateMeta(ref, { title: "Leaked title" })).rejects.toThrow(
        /PROTECTION_DOWNGRADE/
      );
      await expect(
        store.append(ref, [{ kind: "ranking", ranking: [OPT] }]) // reads meta for the round
      ).rejects.toThrow(/PROTECTION_DOWNGRADE/);
      // Writes that do not read meta still go out encrypted with the session key.
      await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Still sealed" }]);

      const raw = JSON.stringify(
        await client.batchGetValues(ref.id, ["meta!A:B", "comments!A:E", "rankings!A:D"])
      );
      expect(raw).not.toContain("Leaked title");
      expect(raw).not.toContain("Still sealed");
    });

    it("treats a salt or verifier change during the session as tampering", async () => {
      const { store, client, ref } = await protectedProject();
      await editMeta(client, ref.id, "salt", Buffer.from(new Uint8Array(16)).toString("base64"));
      await expect(store.openProject(ref, { password: PASSWORD })).rejects.toThrow(
        /PROTECTION_TAMPERED/
      );
    });

    it("refuses KDF iteration counts outside [100k, 5M] from the sheet", async () => {
      const { client, ref } = await protectedProject();
      await editMeta(client, ref.id, "kdfIterations", "2000000000");
      await expect(setupStore().store.openProject(ref, { password: PASSWORD })).rejects.toThrow(
        /INVALID_KDF/
      );
    });
  });

  describe("passwords (F11)", () => {
    it("refuses short passwords before creating anything", async () => {
      const { store } = setupStore();
      const before = await store.listProjects();
      await expect(
        store.createProject({ title: "Weak", options: [option] }, { password: "short" })
      ).rejects.toThrow(/at least 12/);
      expect(await store.listProjects()).toHaveLength(before.length);
    });

    it("refuses short passwords in enablePassword", async () => {
      const { store } = setupStore();
      const ref = await store.createProject({ title: "Plain", options: [option] });
      await expect(store.enablePassword(ref, "elevenchars")).rejects.toThrow(/at least 12/);
    });
  });

  describe("forged rows (F3)", () => {
    it("drops every copy of an entry id that appears with different content", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({ title: "Plain", options: [option] });
      await store.append(ref, [{ kind: "grade", optionId: OPT, value: 5 }]);
      await store.append(ref, [{ kind: "grade", optionId: OPT, value: 2 }]);
      const rows = (await client.batchGetValues(ref.id, ["grades!A:E"])).valueRanges[0]?.values;
      const victim = rows?.[1];
      const other = rows?.[2];
      if (!victim || !other) throw new Error("grade rows missing");
      // A forged copy of the victim's id with another value, and an exact duplicate of another.
      await client.appendValues(ref.id, "grades!A:E", [
        [victim[0] ?? "", victim[1] ?? "", victim[2] ?? "", OPT, JSON.stringify({ value: 1 })],
        [...other],
      ]);

      const snap = await store.openProject(ref);
      expect(snap.grades.map((g) => g.value)).toEqual([2]);
      expect(snap.warnings?.some((w) => w.includes(`id ${victim[0]} appears more than once`))).toBe(
        true
      );
    });

    it("drops an option row whose by column and payload disagree", async () => {
      const row = ["opt_x", "1", "active", "", "mallory@example.com", ""];
      row[5] = JSON.stringify({ ...option, id: "opt_x", by: "alice@example.com" });
      const res = await decodeOptionRow(row, 2, undefined, OWNER);
      expect(res.entity).toBeUndefined();
      expect(res.warning).toMatch(/author mismatch/);

      // Rows written before layout 2.4.0 hold the owner in the column: still read.
      const legacy = [...row];
      legacy[4] = OWNER;
      expect((await decodeOptionRow(legacy, 2, undefined, OWNER)).entity?.by).toBe(
        "alice@example.com"
      );
      // Agreeing values are fine.
      const agreeing = [...row];
      agreeing[4] = "alice@example.com";
      expect((await decodeOptionRow(agreeing, 2, undefined, OWNER)).entity?.by).toBe(
        "alice@example.com"
      );
    });

    it("writes the option author in the by column", async () => {
      const { store, client } = setupStore();
      const ref = await store.createProject({
        title: "Plain",
        options: [{ ...option, by: "alice@example.com" }],
      });
      await store.updateOptions(ref, [{ op: "update", option: { id: OPT, title: "Renamed" } }]);
      const rows = (await client.batchGetValues(ref.id, ["options!A:F"])).valueRanges[0]?.values;
      expect(rows?.[1]?.[4]).toBe("alice@example.com");
      const snap = await store.openProject(ref);
      expect(snap.options[0]).toMatchObject({ title: "Renamed", by: "alice@example.com" });
    });
  });

  describe("cached role (F15)", () => {
    it("uses the role seen earlier when the permission lookup fails, and refuses without one", async () => {
      const ref = await setupStore().store.createProject({ title: "Plain", options: [option] });
      const fresh = setupStore();
      vi.spyOn(fresh.client, "listPermissions").mockRejectedValue(new Error("RATE_LIMITED"));
      await expect(
        fresh.store.append(ref, [{ kind: "grade", optionId: OPT, value: 4 }])
      ).rejects.toThrow("RATE_LIMITED");

      const { store, client } = setupStore();
      await store.openProject(ref);
      vi.spyOn(client, "listPermissions").mockRejectedValue(new Error("RATE_LIMITED"));
      await expect(
        store.append(ref, [{ kind: "grade", optionId: OPT, value: 3 }])
      ).resolves.toBeDefined();
    });
  });

  describe("share link origin (F15)", () => {
    it("uses the running app's origin and path", () => {
      vi.stubGlobal("location", {
        origin: "https://deci.example.org",
        pathname: "/team/index.html",
      });
      expect(projectLinkUrl("abc")).toBe("https://deci.example.org/team/#/p/abc");
    });

    it("falls back to the public app when there is no page", async () => {
      vi.stubGlobal("location", undefined);
      expect(projectLinkUrl("abc")).toBe(`${FALLBACK_APP_URL}#/p/abc`);
    });
  });
});
