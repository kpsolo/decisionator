import "fake-indexeddb/auto";
import * as A from "@automerge/automerge";
import type { Option } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { type AutomergeProjectDoc, LocalProjectStore } from "../src/store.js";

const OWNER = "alice@example.com";
const PASSWORD = "correct-horse-battery-staple";
const OPT = "opt_1";

const option: Option = {
  id: OPT,
  order: 1,
  title: "Option 1",
  description: "Secret option description",
  status: "active",
  tags: [],
  pros: ["Secret pro"],
  cons: [],
  links: [],
  at: "2026-10-05T00:00:00Z",
  by: OWNER,
};

let dbCounter = 0;
function freshDbName(): string {
  dbCounter += 1;
  return `decisionator_local_store_regression_${dbCounter}_${Date.now()}`;
}

async function readRaw(dbName: string, id: string): Promise<AutomergeProjectDoc> {
  const db = await openDB(dbName, 1);
  try {
    const record = await db.get("docs", id);
    return A.toJS(A.load<AutomergeProjectDoc>(record.bytes)) as AutomergeProjectDoc;
  } finally {
    db.close();
  }
}

async function protectedProject() {
  const dbName = freshDbName();
  const store = new LocalProjectStore(OWNER, dbName);
  const ref = await store.createProject(
    { title: "Secret", options: [option] },
    { password: PASSWORD }
  );
  return { dbName, store, ref };
}

describe("LocalProjectStore password-protected projects", () => {
  it("encrypts appended comment bodies and stays readable afterwards", async () => {
    const { dbName, store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Plaintext must not leak" }]);

    const raw = await readRaw(dbName, ref.id);
    expect(raw.comments[0]?.body.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("Plaintext must not leak");

    const reopened = await new LocalProjectStore(OWNER, dbName).openProject(ref, {
      password: PASSWORD,
    });
    expect(reopened.comments[0]?.body).toBe("Plaintext must not leak");
  });

  it("survives a hide/unhide toggle comment with an empty body", async () => {
    const { dbName, store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "To hide" }]);
    const first = (await store.openProject(ref)).comments[0];
    await store.append(ref, [
      { kind: "comment", optionId: OPT, body: "", hidden: true, replaces: first?.id },
    ]);

    const snap = await new LocalProjectStore(OWNER, dbName).openProject(ref, {
      password: PASSWORD,
    });
    expect(snap.comments).toHaveLength(2);
    expect(snap.comments[1]?.body).toBe("");
    expect(snap.comments[1]?.hidden).toBe(true);
  });

  it("refuses to write to a protected project that was not unlocked in this session", async () => {
    const { dbName, store, ref } = await protectedProject();
    await expect(
      store.append(ref, [{ kind: "comment", optionId: OPT, body: "Would be plaintext" }])
    ).rejects.toThrow("Password required");
    await expect(store.append(ref, [{ kind: "grade", optionId: OPT, value: 3 }])).rejects.toThrow(
      "Password required"
    );
    await expect(
      store.updateOptions(ref, [{ op: "update", option: { id: OPT, title: "Leaked" } }])
    ).rejects.toThrow("Password required");
    await expect(store.updateMeta(ref, { title: "Leaked" })).rejects.toThrow("Password required");

    const raw = await readRaw(dbName, ref.id);
    expect(raw.comments).toHaveLength(0);
    expect(raw.grades).toHaveLength(0);
    expect(JSON.stringify(raw)).not.toContain("Leaked");
  });

  it("reuses the session key for password-less opens, but only in the unlocking instance", async () => {
    const { dbName, store, ref } = await protectedProject();
    await expect(store.openProject(ref)).rejects.toThrow("Password required");

    await store.openProject(ref, { password: PASSWORD });
    const snap = await store.openProject(ref);
    expect(snap.project.title).toBe("Secret");

    await expect(store.openProject(ref, { password: "wrong-password" })).rejects.toThrow(
      "Incorrect password"
    );
    await expect(new LocalProjectStore(OWNER, dbName).openProject(ref)).rejects.toThrow(
      "Password required"
    );
  });

  it("notifies watchers of protected projects with decrypted snapshots", async () => {
    const { store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    const seen: ProjectSnapshot[] = [];
    const unsubscribe = store.watch(ref, (s) => seen.push(s));
    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Watched" }]);
    unsubscribe();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.comments[0]?.body).toBe("Watched");
  });

  it("keeps option and title edits encrypted", async () => {
    const { dbName, store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.updateOptions(ref, [
      { op: "update", option: { id: OPT, title: "Renamed secret", pros: ["Edited pro"] } },
      { op: "add", option: { ...option, id: "opt_2", title: "Added secret" } },
    ]);
    await store.updateMeta(ref, { title: "New secret title", description: "New secret desc" });

    const raw = JSON.stringify(await readRaw(dbName, ref.id));
    expect(raw).not.toContain("Renamed secret");
    expect(raw).not.toContain("Edited pro");
    expect(raw).not.toContain("Added secret");
    expect(raw).not.toContain("Secret option description");
    expect(raw).not.toContain("New secret title");
    expect(raw).not.toContain("New secret desc");

    const snap = await new LocalProjectStore(OWNER, dbName).openProject(ref, {
      password: PASSWORD,
    });
    expect(snap.project.title).toBe("New secret title");
    expect(snap.project.description).toBe("New secret desc");
    expect(snap.options.map((o) => o.title)).toEqual(["Renamed secret", "Added secret"]);
    expect(snap.options[0]?.pros).toEqual(["Edited pro"]);
    expect(snap.options[1]?.description).toBe("Secret option description");
  });

  it("reads comment bodies stored in plaintext by older versions instead of failing", async () => {
    const { dbName, store, ref } = await protectedProject();
    const db = await openDB(dbName, 1);
    const record = await db.get("docs", ref.id);
    const doc = A.change(A.load<AutomergeProjectDoc>(record.bytes), (d) => {
      d.comments.push({
        id: "legacy",
        at: "2026-10-01T00:00:00Z",
        by: OWNER,
        optionId: OPT,
        body: "Legacy",
      });
    });
    await db.put("docs", { ...record, bytes: A.save(doc) });
    db.close();

    const snap = await store.openProject(ref, { password: PASSWORD });
    expect(snap.comments[0]?.body).toBe("Legacy");
  });
});

describe("LocalProjectStore concurrent writes", () => {
  it("keeps every entry of concurrent appends for different delegates", async () => {
    const store = new LocalProjectStore(OWNER, freshDbName());
    const ref = await store.createProject({ title: "Busy session", options: [option] });

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.append(ref, [{ kind: "grade", optionId: OPT, value: ((i % 5) + 1) as 1 }], {
          onBehalfOf: { participantId: `peer:${i}`, displayName: `Guest ${i}` },
        })
      )
    );

    const snap = await store.openProject(ref);
    expect(snap.grades).toHaveLength(10);
    expect(new Set(snap.grades.map((g) => g.by)).size).toBe(10);
  });

  it("does not lose an append that races a meta or option update", async () => {
    const store = new LocalProjectStore(OWNER, freshDbName());
    const ref = await store.createProject({ title: "Race", options: [option] });

    await Promise.all([
      store.append(ref, [{ kind: "comment", optionId: OPT, body: "Racing comment" }]),
      store.updateMeta(ref, { title: "Renamed" }),
      store.updateOptions(ref, [{ op: "update", option: { id: OPT, title: "Option renamed" } }]),
      store.append(ref, [{ kind: "grade", optionId: OPT, value: 4 }]),
    ]);

    const snap = await store.openProject(ref);
    expect(snap.project.title).toBe("Renamed");
    expect(snap.options[0]?.title).toBe("Option renamed");
    expect(snap.comments).toHaveLength(1);
    expect(snap.grades).toHaveLength(1);
  });

  it("keeps serving later writes after a rejected one", async () => {
    const store = new LocalProjectStore(OWNER, freshDbName());
    const ref = await store.createProject({ title: "Recover", options: [option] });

    await expect(
      store.append(ref, [{ kind: "grade", optionId: OPT, value: 3 }], {
        onBehalfOf: { participantId: "" },
      })
    ).rejects.toThrow(/^INVALID_ARGUMENT/);
    await store.append(ref, [{ kind: "grade", optionId: OPT, value: 3 }]);

    expect((await store.openProject(ref)).grades).toHaveLength(1);
  });
});
