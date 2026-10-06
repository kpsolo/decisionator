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
    expect(stored?.kind === "comment" && stored.body.startsWith("enc:v1:")).toBe(true);
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
