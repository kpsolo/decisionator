import "fake-indexeddb/auto";
import { type Option, checkVerifier, decrypt, deriveKey } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { FileProjectStore } from "../src/file-store.js";

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
  pros: [],
  cons: [],
  links: [],
  at: "2026-10-05T00:00:00Z",
  by: OWNER,
};

let dbCounter = 0;
function freshDbName(): string {
  dbCounter += 1;
  return `decisionator_file_store_regression_${dbCounter}_${Date.now()}`;
}

interface RawDoc {
  comments: { body: string; by: string }[];
  options: { title: string }[];
  meta: { title: string };
}

async function readRaw(dbName: string, id: string): Promise<RawDoc> {
  const db = await openDB(dbName, 1);
  try {
    return (await db.get("projects", id)) as RawDoc;
  } finally {
    db.close();
  }
}

async function protectedProject() {
  const dbName = freshDbName();
  const store = new FileProjectStore(OWNER, dbName);
  const ref = await store.createProject(
    { title: "Secret", options: [option] },
    { password: PASSWORD }
  );
  return { dbName, store, ref };
}

describe("FileProjectStore password-protected projects", () => {
  it("encrypts appended comment bodies and stays readable afterwards", async () => {
    const { dbName, store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Plaintext must not leak" }]);

    const raw = await readRaw(dbName, ref.id);
    expect(raw.comments[0]?.body.startsWith("enc:v2:")).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("Plaintext must not leak");

    const reopened = await new FileProjectStore(OWNER, dbName).openProject(ref, {
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

    const snap = await new FileProjectStore(OWNER, dbName).openProject(ref, {
      password: PASSWORD,
    });
    expect(snap.comments).toHaveLength(2);
    expect(snap.comments[1]?.body).toBe("");
    expect(snap.comments[1]?.hidden).toBe(true);
  });

  it("refuses to append to a protected project that was not unlocked in this session", async () => {
    const { store, ref } = await protectedProject();
    await expect(
      store.append(ref, [{ kind: "comment", optionId: OPT, body: "Would be plaintext" }])
    ).rejects.toThrow("Password required");
    await expect(store.append(ref, [{ kind: "grade", optionId: OPT, value: 3 }])).rejects.toThrow(
      "Password required"
    );
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
    await expect(new FileProjectStore(OWNER, dbName).openProject(ref)).rejects.toThrow(
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
      { op: "update", option: { id: OPT, title: "Renamed secret" } },
      { op: "add", option: { ...option, id: "opt_2", title: "Added secret" } },
    ]);
    await store.updateMeta(ref, { title: "New secret title" });

    const raw = JSON.stringify(await readRaw(dbName, ref.id));
    expect(raw).not.toContain("Renamed secret");
    expect(raw).not.toContain("Added secret");
    expect(raw).not.toContain("New secret title");

    const snap = await new FileProjectStore(OWNER, dbName).openProject(ref, {
      password: PASSWORD,
    });
    expect(snap.project.title).toBe("New secret title");
    expect(snap.options.map((o) => o.title)).toEqual(["Renamed secret", "Added secret"]);
  });

  it("reads comment bodies stored in plaintext by older versions instead of failing", async () => {
    const { dbName, store, ref } = await protectedProject();
    const db = await openDB(dbName, 1);
    const doc = await db.get("projects", ref.id);
    doc.comments.push({
      id: "legacy",
      at: "2026-10-01T00:00:00Z",
      by: OWNER,
      optionId: OPT,
      body: "Legacy",
    });
    await db.put("projects", doc);
    db.close();

    const snap = await store.openProject(ref, { password: PASSWORD });
    expect(snap.comments[0]?.body).toBe("Legacy");
  });
});

describe("FileProjectStore concurrent writes", () => {
  it("keeps every entry of concurrent appends for different delegates", async () => {
    const store = new FileProjectStore(OWNER, freshDbName());
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
    const store = new FileProjectStore(OWNER, freshDbName());
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
    const store = new FileProjectStore(OWNER, freshDbName());
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

describe("FileProjectStore across tabs", () => {
  async function sharedProject() {
    const dbName = freshDbName();
    const tabA = new FileProjectStore(OWNER, dbName);
    const tabB = new FileProjectStore(OWNER, dbName);
    const ref = await tabA.createProject({ title: "Two tabs", options: [option] });
    return { tabA, tabB, ref };
  }

  async function appendFromBothTabs() {
    const { tabA, tabB, ref } = await sharedProject();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 === 0 ? tabA : tabB).append(ref, [
          { kind: "comment", optionId: OPT, body: `Comment ${i}` },
        ])
      )
    );
    const snap = await tabA.openProject(ref);
    return snap.comments.map((c) => c.body).sort();
  }

  const expected = Array.from({ length: 6 }, (_, i) => `Comment ${i}`);

  it("keeps the appends of two store instances on the same database", async () => {
    expect(await appendFromBothTabs()).toEqual(expected);
  });

  it("keeps them without the Web Locks API too", async () => {
    const original = globalThis.navigator;
    vi.stubGlobal("navigator", {});
    try {
      expect(await appendFromBothTabs()).toEqual(expected);
    } finally {
      vi.stubGlobal("navigator", original);
    }
  });

  it("notifies watchers in another instance of a change", async () => {
    const { tabA, tabB, ref } = await sharedProject();
    const seen: ProjectSnapshot[] = [];
    const unsubscribe = tabB.watch(ref, (s) => seen.push(s));
    try {
      await tabA.append(ref, [{ kind: "comment", optionId: OPT, body: "From tab A" }]);
      await vi.waitFor(() => expect(seen.at(-1)?.comments[0]?.body).toBe("From tab A"));
    } finally {
      unsubscribe();
    }
  });
});

interface WrittenFile {
  project: {
    title: string;
    kdf?: { alg: string; salt: string; iterations: number; verifier?: string };
  };
}

function fakeHandle(opts: { fail?: boolean } = {}) {
  const writes: string[] = [];
  const handle = {
    name: "project.decisionator.json",
    async createWritable() {
      if (opts.fail) throw new Error("The file was moved");
      let data = "";
      return {
        async write(chunk: string) {
          data += chunk;
        },
        async close() {
          writes.push(data);
        },
      };
    },
  };
  return { handle: handle as unknown as FileSystemFileHandle, writes };
}

describe("FileProjectStore linked files", () => {
  it("writes the key derivation parameters of a protected project, so the file can be opened", async () => {
    const { store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });
    const { handle, writes } = fakeHandle();
    store.setFileHandle(ref.id, handle);

    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Linked" }]);

    const written = JSON.parse(writes.at(-1) ?? "{}") as WrittenFile;
    const kdf = written.project.kdf;
    expect(kdf).toMatchObject({ alg: "pbkdf2-sha256", iterations: 600000 });
    if (!kdf?.verifier) throw new Error("kdf.verifier missing");
    const key = await deriveKey(
      PASSWORD,
      new Uint8Array(Buffer.from(kdf.salt, "base64")),
      kdf.iterations
    );
    expect(await checkVerifier(kdf.verifier, key)).toBe(true);
    expect(await decrypt(written.project.title, key, ["meta", "title"])).toBe("Secret");
  });

  it("reports a failed write of the linked file instead of swallowing it", async () => {
    const store = new FileProjectStore(OWNER, freshDbName());
    const ref = await store.createProject({ title: "Linked", options: [option] });
    store.setFileHandle(ref.id, fakeHandle({ fail: true }).handle);
    const errors: { projectId: string; error: Error }[] = [];
    const off = store.onFileSyncError((e) => errors.push(e));

    await store.append(ref, [{ kind: "grade", optionId: OPT, value: 4 }]);
    off();

    // The change itself is kept in the browser.
    expect((await store.openProject(ref)).grades).toHaveLength(1);
    expect(store.getFileSyncError(ref.id)?.message).toMatch(/^FILE_WRITE_FAILED: .*moved/);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.projectId).toBe(ref.id);

    store.setFileHandle(ref.id, fakeHandle().handle);
    await store.append(ref, [{ kind: "grade", optionId: OPT, value: 5 }]);
    expect(store.getFileSyncError(ref.id)).toBeUndefined();
  });
});

describe("FileProjectStore option sealing", () => {
  const secretOption: Option = {
    ...option,
    id: "opt_secret",
    title: "Title_x1",
    description: "Desc_x2",
    category: "Category_x3",
    tags: ["Tag_x4"],
    pros: ["Pro_x5"],
    cons: ["Con_x6"],
    links: [{ title: "Link_x7", url: "https://example.com/Url_x8" }],
  };
  const plaintexts = [
    "Title_x1",
    "Desc_x2",
    "Category_x3",
    "Tag_x4",
    "Pro_x5",
    "Con_x6",
    "Link_x7",
    "Url_x8",
    "Pro_x9",
    "Tag_y1",
    "Url_y2",
  ];

  it("stores no plaintext option field of a protected project", async () => {
    const dbName = freshDbName();
    const store = new FileProjectStore(OWNER, dbName);
    const ref = await store.createProject(
      { title: "Secret", options: [secretOption] },
      { password: PASSWORD }
    );
    await store.openProject(ref, { password: PASSWORD });
    await store.updateOptions(ref, [
      { op: "update", option: { id: "opt_secret", pros: ["Pro_x5", "Pro_x9"] } },
      {
        op: "add",
        option: {
          ...secretOption,
          id: "opt_added",
          tags: ["Tag_y1"],
          links: [{ url: "https://example.com/Url_y2" }],
        },
      },
    ]);

    const raw = JSON.stringify(await readRaw(dbName, ref.id));
    for (const text of plaintexts) expect(raw).not.toContain(text);

    const snap = await new FileProjectStore(OWNER, dbName).openProject(ref, {
      password: PASSWORD,
    });
    const [first, added] = snap.options;
    expect(first).toMatchObject({
      title: "Title_x1",
      description: "Desc_x2",
      category: "Category_x3",
      tags: ["Tag_x4"],
      pros: ["Pro_x5", "Pro_x9"],
      cons: ["Con_x6"],
      links: [{ title: "Link_x7", url: "https://example.com/Url_x8" }],
    });
    expect(added?.tags).toEqual(["Tag_y1"]);
    expect(added?.links).toEqual([{ url: "https://example.com/Url_y2" }]);
  });
});

describe("FileProjectStore author stamping", () => {
  const contribution = {
    id: "ctb_1",
    at: "1999-01-01T00:00:00Z",
    by: "mallory@example.com",
    targetKind: "option" as const,
    targetId: OPT,
    type: "note" as const,
    body: "Note",
    author: { kind: "human" as const },
    reviewStatus: "pending" as const,
  };
  const outcome = {
    strategy: { id: "org.decisionator.strategy.owner-pick", version: "1.0.0" },
    settings: {},
    inputs: { options: [{ id: OPT, title: "Option 1" }] },
    result: { winner: OPT, order: [{ optionId: OPT }] },
    tieBreak: "none" as const,
    triggeredBy: OWNER,
    at: "2026-10-06T00:00:00Z",
  };

  it("stamps contributions with the signed-in author and time", async () => {
    const store = new FileProjectStore(OWNER, freshDbName());
    const ref = await store.createProject({ title: "Stamped", options: [option] });

    await store.append(ref, [{ kind: "contribution", contribution }]);

    const [stored] = (await store.openProject(ref)).contributions ?? [];
    expect(stored?.by).toBe(OWNER);
    expect(stored?.at).not.toBe("1999-01-01T00:00:00Z");
    expect(stored?.id).toBe("ctb_1");
  });

  it("refuses outcomes from non-owners and writes nothing from that call", async () => {
    const dbName = freshDbName();
    const owner = new FileProjectStore(OWNER, dbName);
    const ref = await owner.createProject({ title: "Owned", options: [option] });
    await owner.share(ref, { inviteUsers: [{ email: "bob@example.com", role: "contribute" }] });
    const bob = new FileProjectStore("bob@example.com", dbName);

    await expect(
      bob.append(ref, [
        { kind: "grade", optionId: OPT, value: 3 },
        { kind: "outcome", outcome },
      ])
    ).rejects.toThrow(/^PERMISSION_DENIED/);
    const snap = await owner.openProject(ref);
    expect(snap.outcomes).toHaveLength(0);
    expect(snap.grades).toHaveLength(0);

    await owner.append(ref, [{ kind: "outcome", outcome }]);
    expect((await owner.openProject(ref)).outcomes).toHaveLength(1);
  });
});

async function editRaw(
  dbName: string,
  id: string,
  edit: (doc: Record<string, unknown> & { meta: Record<string, unknown> }) => void
): Promise<void> {
  const db = await openDB(dbName, 1);
  try {
    const doc = await db.get("projects", id);
    edit(doc);
    await db.put("projects", doc);
  } finally {
    db.close();
  }
}

describe("FileProjectStore crypto hardening", () => {
  const second: Option = { ...option, id: "opt_2", order: 2, title: "Option 2" };

  it("refuses passwords shorter than 12 characters", async () => {
    const store = new FileProjectStore(OWNER, freshDbName());
    await expect(
      store.createProject({ title: "Weak", options: [option] }, { password: "short" })
    ).rejects.toThrow(/at least 12/);
  });

  it("does not decrypt an option title swapped in from another option", async () => {
    const dbName = freshDbName();
    const store = new FileProjectStore(OWNER, dbName);
    const ref = await store.createProject(
      { title: "Secret", options: [option, second] },
      { password: PASSWORD }
    );
    await editRaw(dbName, ref.id, (doc) => {
      const [a, b] = doc.options as { title: string }[];
      if (!a || !b) throw new Error("options missing");
      [a.title, b.title] = [b.title, a.title];
    });
    await expect(
      new FileProjectStore(OWNER, dbName).openProject(ref, { password: PASSWORD })
    ).rejects.toThrow();
  });

  it("refuses KDF iteration counts outside [100k, 5M] from the stored document", async () => {
    const { dbName, ref } = await protectedProject();
    await editRaw(dbName, ref.id, (doc) => {
      doc.meta.iterations = 1_000_000_000;
    });
    await expect(
      new FileProjectStore(OWNER, dbName).openProject(ref, { password: PASSWORD })
    ).rejects.toThrow(/INVALID_KDF/);
  });

  it("never writes plaintext to a project unlocked in this session that was flipped to unprotected", async () => {
    const { dbName, store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });
    await editRaw(dbName, ref.id, (doc) => {
      doc.meta.protected = false;
    });
    await expect(
      store.append(ref, [{ kind: "comment", optionId: OPT, body: "Must stay sealed" }])
    ).rejects.toThrow(/PROTECTION_DOWNGRADE/);
    await expect(store.updateMeta(ref, { title: "Leak" })).rejects.toThrow(/PROTECTION_DOWNGRADE/);
    expect(JSON.stringify(await readRaw(dbName, ref.id))).not.toContain("Must stay sealed");
  });
});
