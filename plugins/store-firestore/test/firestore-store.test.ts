import { type Option, deriveKey, encrypt, generateSalt } from "@decisionator/core";
import type { ProjectRef, ProjectSnapshot } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import type {
  FirestoreEntryDoc,
  FirestoreOptionDoc,
  FirestoreProjectDoc,
} from "../src/collections.js";
import { FirestoreProjectStore } from "../src/firestore-store.js";

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

interface Collections {
  projects: Map<string, FirestoreProjectDoc>;
  options: Map<string, Map<string, FirestoreOptionDoc>>;
  entries: Map<string, FirestoreEntryDoc[]>;
}

function collections(store: FirestoreProjectStore): Collections {
  return store as unknown as Collections;
}

/** The stored documents of one project, as Firestore would hold them. */
function readRaw(store: FirestoreProjectStore, ref: ProjectRef) {
  const c = collections(store);
  return {
    project: c.projects.get(ref.id),
    options: Array.from(c.options.get(ref.id)?.values() ?? []),
    entries: c.entries.get(ref.id) ?? [],
  };
}

/** A second client of the same Firestore project: shares the data, not the session keys. */
function otherClient(store: FirestoreProjectStore): FirestoreProjectStore {
  const other = new FirestoreProjectStore(OWNER);
  Object.assign(other, {
    projects: collections(store).projects,
    options: collections(store).options,
    entries: collections(store).entries,
  });
  return other;
}

async function protectedProject() {
  const store = new FirestoreProjectStore(OWNER);
  const ref = await store.createProject(
    { title: "Secret", options: [option] },
    { password: PASSWORD }
  );
  return { store, ref };
}

describe("FirestoreProjectStore password-protected projects", () => {
  it("encrypts appended comment bodies and stays readable afterwards", async () => {
    const { store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Plaintext must not leak" }]);

    const raw = readRaw(store, ref);
    const stored = raw.entries[0];
    expect(stored?.kind === "comment" && stored.body.startsWith("enc:v2:")).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("Plaintext must not leak");

    const reopened = await otherClient(store).openProject(ref, { password: PASSWORD });
    expect(reopened.comments[0]?.body).toBe("Plaintext must not leak");
  });

  it("survives a hide/unhide toggle comment with an empty body", async () => {
    const { store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "To hide" }]);
    const first = (await store.openProject(ref)).comments[0];
    await store.append(ref, [
      { kind: "comment", optionId: OPT, body: "", hidden: true, replaces: first?.id },
    ]);

    const snap = await otherClient(store).openProject(ref, { password: PASSWORD });
    expect(snap.comments).toHaveLength(2);
    expect(snap.comments[1]?.body).toBe("");
    expect(snap.comments[1]?.hidden).toBe(true);
  });

  it("refuses to write to a protected project that was not unlocked in this session", async () => {
    const { store, ref } = await protectedProject();
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

    const raw = readRaw(store, ref);
    expect(raw.entries).toHaveLength(0);
    expect(JSON.stringify(raw)).not.toContain("Leaked");
  });

  it("reuses the session key for password-less opens, but only in the unlocking instance", async () => {
    const { store, ref } = await protectedProject();
    await expect(store.openProject(ref)).rejects.toThrow("Password required");

    await store.openProject(ref, { password: PASSWORD });
    const snap = await store.openProject(ref);
    expect(snap.project.title).toBe("Secret");

    await expect(store.openProject(ref, { password: "wrong-password" })).rejects.toThrow(
      "Incorrect password"
    );
    await expect(otherClient(store).openProject(ref)).rejects.toThrow("Password required");
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
    const { store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });

    await store.updateOptions(ref, [
      { op: "update", option: { id: OPT, title: "Renamed secret" } },
      { op: "add", option: { ...option, id: "opt_2", title: "Added secret" } },
    ]);
    await store.updateMeta(ref, { title: "New secret title", description: "New secret desc" });

    const raw = JSON.stringify(readRaw(store, ref));
    expect(raw).not.toContain("Renamed secret");
    expect(raw).not.toContain("Added secret");
    expect(raw).not.toContain("Secret option description");
    expect(raw).not.toContain("New secret title");
    expect(raw).not.toContain("New secret desc");

    const snap = await otherClient(store).openProject(ref, { password: PASSWORD });
    expect(snap.project.title).toBe("New secret title");
    expect(snap.project.description).toBe("New secret desc");
    expect(snap.options.map((o) => o.title)).toEqual(["Renamed secret", "Added secret"]);
  });

  it("reads comment bodies stored in plaintext by older versions instead of failing", async () => {
    const { store, ref } = await protectedProject();
    readRaw(store, ref).entries.push({
      id: "legacy",
      kind: "comment",
      optionId: OPT,
      body: "Legacy",
      by: OWNER,
      at: "2026-10-01T00:00:00Z",
    });

    const snap = await store.openProject(ref, { password: PASSWORD });
    expect(snap.comments[0]?.body).toBe("Legacy");
  });

  it("fails instead of returning ciphertext it cannot decrypt", async () => {
    const { store, ref } = await protectedProject();
    const foreignKey = await deriveKey("another-password", generateSalt(), 1000);
    readRaw(store, ref).entries.push({
      id: "foreign",
      kind: "comment",
      optionId: OPT,
      body: await encrypt("Sealed with another key", foreignKey),
      by: OWNER,
      at: "2026-10-01T00:00:00Z",
    });

    await expect(store.openProject(ref, { password: PASSWORD })).rejects.toThrow();
  });
});

describe("FirestoreProjectStore option sealing", () => {
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
    const store = new FirestoreProjectStore(OWNER);
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

    const raw = JSON.stringify(readRaw(store, ref));
    for (const text of plaintexts) expect(raw).not.toContain(text);

    const snap = await otherClient(store).openProject(ref, { password: PASSWORD });
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

describe("FirestoreProjectStore author stamping", () => {
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

  /** Another participant's client of the same Firestore project. */
  function clientOf(store: FirestoreProjectStore, user: string): FirestoreProjectStore {
    const other = new FirestoreProjectStore(user);
    Object.assign(other, {
      projects: collections(store).projects,
      options: collections(store).options,
      entries: collections(store).entries,
    });
    return other;
  }

  it("stamps contributions with the signed-in author and time", async () => {
    const store = new FirestoreProjectStore(OWNER);
    const ref = await store.createProject({ title: "Stamped", options: [option] });

    await store.append(ref, [{ kind: "contribution", contribution }]);

    const [stored] = (await store.openProject(ref)).contributions ?? [];
    expect(stored?.by).toBe(OWNER);
    expect(stored?.at).not.toBe("1999-01-01T00:00:00Z");
    expect(stored?.id).toBe("ctb_1");
  });

  it("refuses outcomes from non-owners and writes nothing from that call", async () => {
    const owner = new FirestoreProjectStore(OWNER);
    const ref = await owner.createProject({ title: "Owned", options: [option] });
    await owner.share(ref, { inviteUsers: [{ email: "bob@example.com", role: "contribute" }] });
    const bob = clientOf(owner, "bob@example.com");

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

describe("FirestoreProjectStore crypto hardening", () => {
  const second: Option = { ...option, id: "opt_2", order: 2, title: "Option 2" };

  it("refuses passwords shorter than 12 characters", async () => {
    const store = new FirestoreProjectStore(OWNER);
    await expect(
      store.createProject({ title: "Weak", options: [option] }, { password: "short" })
    ).rejects.toThrow(/at least 12/);
  });

  it("does not decrypt an option title swapped in from another option", async () => {
    const store = new FirestoreProjectStore(OWNER);
    const ref = await store.createProject(
      { title: "Secret", options: [option, second] },
      { password: PASSWORD }
    );
    const [a, b] = readRaw(store, ref).options;
    if (!a || !b) throw new Error("options missing");
    [a.title, b.title] = [b.title, a.title];
    await expect(otherClient(store).openProject(ref, { password: PASSWORD })).rejects.toThrow();
  });

  it("refuses KDF iteration counts outside [100k, 5M] from the stored document", async () => {
    const { store, ref } = await protectedProject();
    const project = readRaw(store, ref).project;
    if (!project) throw new Error("project missing");
    project.iterations = 99_999;
    await expect(otherClient(store).openProject(ref, { password: PASSWORD })).rejects.toThrow(
      /INVALID_KDF/
    );
  });

  it("never writes plaintext to a project unlocked in this session that was flipped to unprotected", async () => {
    const { store, ref } = await protectedProject();
    await store.openProject(ref, { password: PASSWORD });
    const project = readRaw(store, ref).project;
    if (!project) throw new Error("project missing");
    project.protected = false;
    await expect(
      store.append(ref, [{ kind: "comment", optionId: OPT, body: "Must stay sealed" }])
    ).rejects.toThrow(/PROTECTION_DOWNGRADE/);
    expect(JSON.stringify(readRaw(store, ref).entries)).not.toContain("Must stay sealed");
  });
});
