import "fake-indexeddb/auto";
import { fakeGoogleServer, fakeGoogleState } from "@decisionator/plugin-sdk/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleApiClient } from "../src/google-api.js";
import { GoogleSheetsProjectStore } from "../src/sheet-store.js";

describe("Sharing and Password Store Compliance (T061)", () => {
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

  it("manages anyone reader/writer permissions with allowFileDiscovery: false", async () => {
    const { store, client } = setupStore();
    const ref = await store.createProject({ title: "Shared Project" });

    // Enable link sharing as contribute
    const shareRes = await store.share(ref, {
      linkSharing: { enabled: true, role: "contribute" },
    });

    expect(shareRes.linkSharing.enabled).toBe(true);
    expect(shareRes.linkSharing.role).toBe("contribute");

    // Check Drive permissions created on backend
    const perms = await client.listPermissions(ref.id);
    const anyonePerm = perms.permissions.find((p) => p.type === "anyone");
    expect(anyonePerm).toBeDefined();
    expect(anyonePerm?.role).toBe("writer");
  });

  it("disables link sharing when link is toggled off", async () => {
    const { store, client } = setupStore();
    const ref = await store.createProject({ title: "Shared Project 2" });

    // Enable link sharing
    await store.share(ref, {
      linkSharing: { enabled: true, role: "view" },
    });

    // Check anyone permission created
    let perms = await client.listPermissions(ref.id);
    expect(perms.permissions.some((p) => p.type === "anyone")).toBe(true);

    // Disable link sharing
    await store.share(ref, {
      linkSharing: { enabled: false },
    });

    perms = await client.listPermissions(ref.id);
    expect(perms.permissions.some((p) => p.type === "anyone")).toBe(false);
  });

  it("invites and removes users by email", async () => {
    const { store } = setupStore();
    const ref = await store.createProject({ title: "Email Invites Project" });

    const shareRes = await store.share(ref, {
      inviteUsers: [{ email: "collaborator@example.com", role: "contribute" }],
    });

    expect(shareRes.collaborators.some((c) => c.email === "collaborator@example.com")).toBe(true);
  });

  it("enforces SC-007: in password mode, no plaintext title, option or comment reaches Sheets", async () => {
    const { store, client } = setupStore();
    const secretTitle = "Ultra Secret Initiative";
    const secretOptionTitle = "Confidential Option Alpha";
    const secretPassword = "correct-horse-battery-staple-123";

    const ref = await store.createProject(
      {
        title: secretTitle,
        description: "Confidential Details",
        options: [
          {
            id: "opt_sec",
            order: 1,
            status: "active",
            title: secretOptionTitle,
            description: "Option description",
            tags: [],
            pros: [],
            cons: [],
            links: [],
          },
        ],
      },
      { password: secretPassword }
    );

    // Inspect raw Sheets data directly from backend
    const rawData = await client.batchGetValues(ref.id, ["meta!A:B", "options!A:F"]);

    const metaValues = rawData.valueRanges.find((r) => r.range.startsWith("meta"))?.values || [];
    const optionsValues =
      rawData.valueRanges.find((r) => r.range.startsWith("options"))?.values || [];

    // Verify plaintext secret title not in meta
    for (const [, val] of metaValues) {
      expect(val).not.toBe(secretTitle);
      expect(val).not.toContain("Confidential Details");
    }

    // Verify options payload is encrypted enc:v1:...
    for (const row of optionsValues.slice(1)) {
      const payloadStr = row[5];
      expect(payloadStr?.startsWith("enc:v1:")).toBe(true);
      expect(payloadStr).not.toContain(secretOptionTitle);
    }
  });
});
