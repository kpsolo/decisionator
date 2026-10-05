import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Entry, ProjectStore } from "../src/project-store.js";
import { fakeGoogleServer, fakeGoogleState } from "./fake-google/index.js";

export type ProjectStoreFactory = (opts?: { currentUserEmail?: string }) => Promise<ProjectStore>;

/**
 * Runs contract tests verifying any implementation of ProjectStore against the specification in
 * contracts/project-store.md.
 */
export function runProjectStoreContractTests(factory: ProjectStoreFactory): void {
  describe("ProjectStore Contract Suite", () => {
    beforeAll(() => fakeGoogleServer.listen());
    afterEach(() => {
      fakeGoogleServer.resetHandlers();
      fakeGoogleState.reset();
    });
    afterAll(() => fakeGoogleServer.close());

    it("verifies append-only behavior and latest-wins rules", async () => {
      fakeGoogleState.setCurrentUser("alice@example.com");
      const store = await factory({ currentUserEmail: "alice@example.com" });

      const ref = await store.createProject({
        title: "Test Project",
        options: [
          {
            id: "01J00000000000000000000001",
            order: 1,
            title: "Option 1",
            description: "Option 1 description",
            status: "active",
            tags: [],
            pros: [],
            cons: [],
            links: [],
            at: "2026-10-05T00:00:00Z",
            by: "alice@example.com",
          },
        ],
      });

      // Append grade 1
      await store.append(ref, [
        {
          kind: "grade",
          optionId: "01J00000000000000000000001",
          value: 3,
        },
      ]);

      let snapshot = await store.openProject(ref);
      expect(snapshot.grades.length).toBe(1);
      expect(snapshot.grades[0]?.value).toBe(3);

      // Append grade 2 by same author for same option -> latest wins
      await store.append(ref, [
        {
          kind: "grade",
          optionId: "01J00000000000000000000001",
          value: 5,
        },
      ]);

      snapshot = await store.openProject(ref);
      const effectiveGrade = snapshot.grades.find(
        (g) => g.optionId === "01J00000000000000000000001" && g.by === "alice@example.com"
      );
      expect(effectiveGrade?.value).toBe(5);

      // Ranking: latest-wins for rankings per (by, round)
      await store.append(ref, [
        {
          kind: "ranking",
          round: 1,
          ranking: ["01J00000000000000000000001"],
        },
      ]);

      snapshot = await store.openProject(ref);
      expect(snapshot.rankings.length).toBe(1);
      expect(snapshot.rankings[0]?.ranking).toEqual(["01J00000000000000000000001"]);
    });

    it("stamps author identity from authenticated session, ignoring caller-supplied 'by'", async () => {
      fakeGoogleState.setCurrentUser("alice@example.com");
      const store = await factory({ currentUserEmail: "alice@example.com" });

      const ref = await store.createProject({
        title: "Author Stamping Project",
        options: [
          {
            id: "01J00000000000000000000001",
            order: 1,
            title: "Option 1",
            description: "Option 1 description",
            status: "active",
            tags: [],
            pros: [],
            cons: [],
            links: [],
            at: "2026-10-05T00:00:00Z",
            by: "alice@example.com",
          },
        ],
      });

      // Attempt to spoof entry with another participant
      const spoofedEntry = {
        kind: "comment" as const,
        optionId: "01J00000000000000000000001",
        body: "Legitimate comment",
        by: "imposter@example.com",
      } as unknown as Entry;

      await store.append(ref, [spoofedEntry]);

      const snapshot = await store.openProject(ref);
      expect(snapshot.comments.length).toBe(1);
      expect(snapshot.comments[0]?.by).toBe("alice@example.com");
    });

    it("enforces access levels: view role cannot append or update options", async () => {
      fakeGoogleState.setCurrentUser("alice@example.com");
      const storeAlice = await factory({ currentUserEmail: "alice@example.com" });
      const ref = await storeAlice.createProject({
        title: "Access Level Project",
        options: [],
      });

      // Share with charlie as view (reader)
      await storeAlice.share(ref, {
        inviteUsers: [{ email: "charlie@example.com", role: "view" }],
      });

      // Charlie signs in
      fakeGoogleState.setCurrentUser("charlie@example.com");
      const storeCharlie = await factory({ currentUserEmail: "charlie@example.com" });

      const snap = await storeCharlie.openProject(ref);
      expect(snap.role).toBe("view");

      // Appending as view role must fail with permission error
      await expect(
        storeCharlie.append(ref, [
          {
            kind: "grade",
            optionId: "01J00000000000000000000001",
            value: 4,
          },
        ])
      ).rejects.toThrow();
    });

    it("verifies password round trip and unreadability without password", async () => {
      fakeGoogleState.setCurrentUser("alice@example.com");
      const store = await factory({ currentUserEmail: "alice@example.com" });

      const ref = await store.createProject(
        {
          title: "Secret Project",
          description: "Top secret details",
          options: [
            {
              id: "01J00000000000000000000001",
              order: 1,
              title: "Encrypted Option",
              description: "Option secret description",
              status: "active",
              tags: [],
              pros: [],
              cons: [],
              links: [],
              at: "2026-10-05T00:00:00Z",
              by: "alice@example.com",
            },
          ],
        },
        { password: "correct-horse-battery-staple" }
      );

      // Opening without password or with wrong password should fail
      await expect(store.openProject(ref)).rejects.toThrow();
      await expect(store.openProject(ref, { password: "wrong-password" })).rejects.toThrow();

      // Opening with correct password succeeds
      const snap = await store.openProject(ref, { password: "correct-horse-battery-staple" });
      expect(snap.project.title).toBe("Secret Project");
      expect(snap.project.description).toBe("Top secret details");
    });

    it("verifies deleteProject behavior: owner trashes, non-owner gets PERMISSION_DENIED", async () => {
      fakeGoogleState.setCurrentUser("alice@example.com");
      const storeAlice = await factory({ currentUserEmail: "alice@example.com" });
      const ref = await storeAlice.createProject({
        title: "Project To Delete",
        options: [],
      });

      // Bob signs in
      fakeGoogleState.setCurrentUser("bob@example.com");
      const storeBob = await factory({ currentUserEmail: "bob@example.com" });

      // Non-owner delete attempt fails
      await expect(storeBob.deleteProject(ref)).rejects.toThrow(/PERMISSION_DENIED|denied/i);

      // Owner deletes project
      fakeGoogleState.setCurrentUser("alice@example.com");
      await storeAlice.deleteProject(ref);

      // Subsequent opens fail for everyone
      await expect(storeAlice.openProject(ref)).rejects.toThrow(/unavailable|not found/i);
      await expect(storeBob.openProject(ref)).rejects.toThrow(/unavailable|not found/i);
    });

    it("verifies queue and backoff behavior under 429", async () => {
      fakeGoogleState.setCurrentUser("alice@example.com");
      const store = await factory({ currentUserEmail: "alice@example.com" });
      const ref = await store.createProject({
        title: "Rate Limited Project",
        options: [],
      });

      fakeGoogleState.injectRateLimit(429);

      // Append reports queued items when rate limited
      const result = await store.append(ref, [
        {
          kind: "comment",
          optionId: "01J00000000000000000000001",
          body: "Queued during 429",
        },
      ]);

      // Either queued or retried successfully once backoff cleared
      expect(result.queued + result.sent).toBeGreaterThanOrEqual(1);
    });
  });
}
