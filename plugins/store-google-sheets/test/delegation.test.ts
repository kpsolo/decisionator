import "fake-indexeddb/auto";
import { fakeGoogleServer, fakeGoogleState } from "@decisionator/plugin-sdk/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleApiClient } from "../src/google-api.js";
import { decodeGradeRow } from "../src/rows.js";
import { GoogleSheetsProjectStore } from "../src/sheet-store.js";

const PASSWORD = "correct-horse-battery-staple-123";
const OPT = "opt_1";

describe("GoogleSheetsProjectStore delegated append and protected writes", () => {
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

  it("keeps the grades layout and stores byName inside the payload", async () => {
    const { store, client } = setupStore();
    const ref = await store.createProject({ title: "Layout", options: [option] });

    await store.append(ref, [{ kind: "grade", optionId: OPT, value: 4 }], {
      onBehalfOf: { participantId: "peer:a", displayName: "Ann" },
    });

    const raw = await client.batchGetValues(ref.id, ["grades!A:E"]);
    const rows = raw.valueRanges[0]?.values ?? [];
    expect(rows[0]).toEqual(["id", "at", "by", "optionId", "payload"]);
    expect(rows[1]).toHaveLength(5);
    expect(rows[1]?.[2]).toBe("peer:a");
    expect(JSON.parse(rows[1]?.[4] ?? "{}")).toEqual({ value: 4, byName: "Ann" });
  });

  it("encrypts appended payloads of a protected project and refuses to write before unlock", async () => {
    const { store, client } = setupStore();
    const ref = await store.createProject(
      { title: "Secret", options: [option] },
      { password: PASSWORD }
    );

    await expect(
      store.append(ref, [{ kind: "comment", optionId: OPT, body: "Too early" }])
    ).rejects.toThrow(/Password required/);

    await store.openProject(ref, { password: PASSWORD });
    await store.append(ref, [{ kind: "comment", optionId: OPT, body: "Guest secret" }], {
      onBehalfOf: { participantId: "peer:a", displayName: "Ann" },
    });
    await store.append(ref, [{ kind: "grade", optionId: OPT, value: 2 }]);

    const raw = await client.batchGetValues(ref.id, ["comments!A:E", "grades!A:E"]);
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain("Guest secret");
    expect(dump).not.toContain("Ann");
    for (const range of raw.valueRanges) {
      for (const row of (range.values ?? []).slice(1)) {
        expect(row[4]?.startsWith("enc:v1:")).toBe(true);
      }
    }

    // A password-less open in the unlocking session reuses the key (watch polling relies on it).
    const snap = await store.openProject(ref);
    expect(snap.comments[0]?.body).toBe("Guest secret");
    expect(snap.comments[0]?.byName).toBe("Ann");
    expect(snap.grades[0]?.value).toBe(2);
  });

  it("updates meta by key without corrupting protected projects", async () => {
    const { store, client } = setupStore();
    const ref = await store.createProject(
      { title: "Secret", description: "Details", options: [option] },
      { password: PASSWORD }
    );
    await store.openProject(ref, { password: PASSWORD });

    await store.updateMeta(ref, {
      title: "Renamed secret",
      voting: { state: "closed", round: 1, topN: 3, liveResults: true },
    });
    await store.updateOptions(ref, [{ op: "update", option: { id: OPT, title: "Option secret" } }]);

    const dump = JSON.stringify(await client.batchGetValues(ref.id, ["meta!A:B", "options!A:F"]));
    expect(dump).not.toContain("Renamed secret");
    expect(dump).not.toContain("Option secret");

    const fresh = setupStore().store;
    const snap = await fresh.openProject(ref, { password: PASSWORD });
    expect(snap.project.title).toBe("Renamed secret");
    expect(snap.project.description).toBe("Details");
    expect(snap.project.voting).toMatchObject({ state: "closed", round: 1, topN: 3 });
    expect(snap.options[0]?.title).toBe("Option secret");
  });

  it("reads byName leniently from row payloads", async () => {
    const valid = await decodeGradeRow(
      ["g1", "2026-10-06T00:00:00Z", "peer:a", OPT, JSON.stringify({ value: 3, byName: " Ann " })],
      2
    );
    expect(valid.entity?.byName).toBe("Ann");

    const malformed = await decodeGradeRow(
      ["g2", "2026-10-06T00:00:00Z", "peer:b", OPT, JSON.stringify({ value: 3, byName: 42 })],
      3
    );
    expect(malformed.warning).toBeUndefined();
    expect(malformed.entity?.value).toBe(3);
    expect(malformed.entity?.byName).toBeUndefined();
  });
});
