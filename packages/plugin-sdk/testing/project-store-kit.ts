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

    describe("share (v1.2.1)", () => {
      async function sharedProject() {
        fakeGoogleState.setCurrentUser("alice@example.com");
        const storeAlice = await factory({ currentUserEmail: "alice@example.com" });
        const ref = await storeAlice.createProject({ title: "Shared Project", options: [] });
        await storeAlice.share(ref, {
          inviteUsers: [
            { email: "bob@example.com", role: "view" },
            { email: "carol@example.com", role: "contribute" },
          ],
        });
        return { storeAlice, ref };
      }

      function roleOf(state: { collaborators: { email: string; role: string }[] }, email: string) {
        return state.collaborators.find((c) => c.email === email)?.role;
      }

      it("non-owner share is rejected with PERMISSION_DENIED", async () => {
        const { storeAlice, ref } = await sharedProject();

        fakeGoogleState.setCurrentUser("bob@example.com");
        const storeBob = await factory({ currentUserEmail: "bob@example.com" });
        await expect(
          storeBob.share(ref, { inviteUsers: [{ email: "mallory@example.com", role: "view" }] })
        ).rejects.toThrow(/^PERMISSION_DENIED/);
        await expect(
          storeBob.share(ref, { inviteUsers: [{ email: "bob@example.com", role: "contribute" }] })
        ).rejects.toThrow(/^PERMISSION_DENIED/);

        fakeGoogleState.setCurrentUser("carol@example.com");
        const storeCarol = await factory({ currentUserEmail: "carol@example.com" });
        await expect(storeCarol.share(ref, { removeUsers: ["bob@example.com"] })).rejects.toThrow(
          /^PERMISSION_DENIED/
        );
        await expect(
          storeCarol.share(ref, { linkSharing: { enabled: true, role: "contribute" } })
        ).rejects.toThrow(/^PERMISSION_DENIED/);

        fakeGoogleState.setCurrentUser("alice@example.com");
        const state = await storeAlice.getShareState(ref);
        expect(roleOf(state, "bob@example.com")).toBe("view");
        expect(roleOf(state, "carol@example.com")).toBe("contribute");
        expect(roleOf(state, "mallory@example.com")).toBeUndefined();
      });

      it("owner removeUsers revokes the named collaborators only", async () => {
        const { storeAlice, ref } = await sharedProject();

        const state = await storeAlice.share(ref, { removeUsers: ["bob@example.com"] });
        expect(roleOf(state, "bob@example.com")).toBeUndefined();
        expect(roleOf(state, "carol@example.com")).toBe("contribute");

        const reread = await storeAlice.getShareState(ref);
        expect(roleOf(reread, "bob@example.com")).toBeUndefined();
        expect(roleOf(reread, "carol@example.com")).toBe("contribute");
      });
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

    describe("delegated append (v1.2.0)", () => {
      const OPT_A = "01J00000000000000000000001";
      const OPT_B = "01J00000000000000000000002";
      const twoOptions = [OPT_A, OPT_B].map((id, idx) => ({
        id,
        order: idx + 1,
        title: `Option ${idx + 1}`,
        description: `Option ${idx + 1} description`,
        status: "active" as const,
        tags: [],
        pros: [],
        cons: [],
        links: [],
        at: "2026-10-05T00:00:00Z",
        by: "alice@example.com",
      }));

      async function ownerProject(password?: string) {
        fakeGoogleState.setCurrentUser("alice@example.com");
        const store = await factory({ currentUserEmail: "alice@example.com" });
        const ref = await store.createProject(
          { title: "Live Session Project", options: twoOptions },
          password ? { password } : undefined
        );
        return { store, ref };
      }

      it("records delegated grades under each delegate without replacing the owner's grade", async () => {
        const { store, ref } = await ownerProject();

        await store.append(ref, [{ kind: "grade", optionId: OPT_A, value: 4 }]);
        await store.append(ref, [{ kind: "grade", optionId: OPT_A, value: 2 }], {
          onBehalfOf: { participantId: "peer:a", displayName: "Ann" },
        });
        // A caller-supplied `by` is ignored: the delegate id wins.
        await store.append(
          ref,
          [{ kind: "grade", optionId: OPT_A, value: 5, by: "mallory@example.com" } as Entry],
          { onBehalfOf: { participantId: "peer:b", displayName: "  Ben  " } }
        );

        const snap = await store.openProject(ref);
        const grades = snap.grades.filter((g) => g.optionId === OPT_A);
        expect(grades).toHaveLength(3);

        const own = grades.find((g) => g.by === "alice@example.com");
        expect(own?.value).toBe(4);
        expect(own?.byName).toBeUndefined();

        const a = grades.find((g) => g.by === "peer:a");
        expect(a?.value).toBe(2);
        expect(a?.byName).toBe("Ann");
        expect(a?.at).toBeTruthy();

        const b = grades.find((g) => g.by === "peer:b");
        expect(b?.value).toBe(5);
        expect(b?.byName).toBe("Ben");
        expect(grades.some((g) => g.by === "mallory@example.com")).toBe(false);
      });

      it("records delegated comments and omits byName when the delegate has no name", async () => {
        const { store, ref } = await ownerProject();

        await store.append(ref, [{ kind: "comment", optionId: OPT_A, body: "From a guest" }], {
          onBehalfOf: { participantId: "peer:anon" },
        });

        const snap = await store.openProject(ref);
        expect(snap.comments).toHaveLength(1);
        expect(snap.comments[0]?.by).toBe("peer:anon");
        expect(snap.comments[0]?.body).toBe("From a guest");
        expect(snap.comments[0]?.byName).toBeUndefined();
      });

      it("applies latest-wins per delegate: grades per (by, optionId), rankings per (by, round)", async () => {
        const { store, ref } = await ownerProject();
        const peerA = { onBehalfOf: { participantId: "peer:a", displayName: "Ann" } };

        await store.append(ref, [{ kind: "grade", optionId: OPT_A, value: 2 }], peerA);
        await store.append(ref, [{ kind: "grade", optionId: OPT_A, value: 3 }], peerA);

        await store.append(ref, [{ kind: "ranking", round: 1, ranking: [OPT_A, OPT_B] }]);
        await store.append(ref, [{ kind: "ranking", round: 1, ranking: [OPT_A] }], peerA);
        await store.append(ref, [{ kind: "ranking", round: 1, ranking: [OPT_B, OPT_A] }], peerA);
        await store.append(ref, [{ kind: "ranking", round: 2, ranking: [OPT_A, OPT_B] }], peerA);

        const snap = await store.openProject(ref);

        const aGrades = snap.grades.filter((g) => g.by === "peer:a" && g.optionId === OPT_A);
        expect(aGrades).toHaveLength(1);
        expect(aGrades[0]?.value).toBe(3);

        const aRound1 = snap.rankings.filter((r) => r.by === "peer:a" && r.round === 1);
        expect(aRound1).toHaveLength(1);
        expect(aRound1[0]?.ranking).toEqual([OPT_B, OPT_A]);
        expect(aRound1[0]?.byName).toBe("Ann");

        const aRound2 = snap.rankings.filter((r) => r.by === "peer:a" && r.round === 2);
        expect(aRound2).toHaveLength(1);
        expect(aRound2[0]?.ranking).toEqual([OPT_A, OPT_B]);

        const own = snap.rankings.filter((r) => r.by === "alice@example.com");
        expect(own).toHaveLength(1);
        expect(own[0]?.ranking).toEqual([OPT_A, OPT_B]);
      });

      it("rejects delegation by a non-owner with PERMISSION_DENIED", async () => {
        const { store: storeAlice, ref } = await ownerProject();
        await storeAlice.share(ref, {
          inviteUsers: [{ email: "bob@example.com", role: "contribute" }],
        });

        fakeGoogleState.setCurrentUser("bob@example.com");
        const storeBob = await factory({ currentUserEmail: "bob@example.com" });

        await expect(
          storeBob.append(ref, [{ kind: "grade", optionId: OPT_A, value: 1 }], {
            onBehalfOf: { participantId: "peer:a" },
          })
        ).rejects.toThrow(/PERMISSION_DENIED/);

        fakeGoogleState.setCurrentUser("alice@example.com");
        const snap = await storeAlice.openProject(ref);
        expect(snap.grades.some((g) => g.by === "peer:a")).toBe(false);
      });

      it("rejects delegated outcome and contribution entries and writes nothing from that call", async () => {
        const { store, ref } = await ownerProject();
        const outcome = {
          strategy: { id: "org.decisionator.strategy.owner-pick", version: "1.0.0" },
          settings: {},
          inputs: { options: [{ id: OPT_A, title: "Option 1" }] },
          result: { winner: OPT_A, order: [{ optionId: OPT_A }] },
          tieBreak: "none" as const,
          triggeredBy: "peer:a",
          at: "2026-10-06T00:00:00Z",
        };

        await expect(
          store.append(
            ref,
            [
              { kind: "grade", optionId: OPT_A, value: 5 },
              { kind: "outcome", outcome },
            ],
            { onBehalfOf: { participantId: "peer:a" } }
          )
        ).rejects.toThrow(/PERMISSION_DENIED/);

        await expect(
          store.append(
            ref,
            [
              { kind: "comment", optionId: OPT_A, body: "Should not land" },
              {
                kind: "contribution",
                contribution: {
                  id: "ctb_1",
                  at: "2026-10-06T00:00:00Z",
                  by: "peer:a",
                  targetKind: "option",
                  targetId: OPT_A,
                  type: "note",
                  body: "Note",
                  author: { kind: "human" },
                  reviewStatus: "pending",
                },
              },
            ],
            { onBehalfOf: { participantId: "peer:a" } }
          )
        ).rejects.toThrow(/PERMISSION_DENIED/);

        const snap = await store.openProject(ref);
        expect(snap.grades).toHaveLength(0);
        expect(snap.comments).toHaveLength(0);
        expect(snap.outcomes).toHaveLength(0);
        expect(snap.contributions ?? []).toHaveLength(0);
      });

      it("rejects malformed delegates with INVALID_ARGUMENT", async () => {
        const { store, ref } = await ownerProject();
        const grade: Entry[] = [{ kind: "grade", optionId: OPT_A, value: 3 }];

        await expect(
          store.append(ref, grade, { onBehalfOf: { participantId: "" } })
        ).rejects.toThrow(/^INVALID_ARGUMENT/);
        await expect(
          store.append(ref, grade, { onBehalfOf: { participantId: "x".repeat(201) } })
        ).rejects.toThrow(/^INVALID_ARGUMENT/);
        await expect(
          store.append(ref, grade, { onBehalfOf: { participantId: "peer:a", displayName: "   " } })
        ).rejects.toThrow(/^INVALID_ARGUMENT/);
        await expect(
          store.append(ref, grade, {
            onBehalfOf: { participantId: "peer:a", displayName: "n".repeat(81) },
          })
        ).rejects.toThrow(/^INVALID_ARGUMENT/);

        const snap = await store.openProject(ref);
        expect(snap.grades).toHaveLength(0);
      });

      it("round-trips a delegated comment on a password-protected project", async () => {
        const password = "correct-horse-battery-staple";
        const { store, ref } = await ownerProject(password);

        // The owner unlocks the project in this session before recording guest entries.
        await store.openProject(ref, { password });
        await store.append(ref, [{ kind: "comment", optionId: OPT_A, body: "Owner note" }]);
        await store.append(ref, [{ kind: "comment", optionId: OPT_A, body: "Guest secret" }], {
          onBehalfOf: { participantId: "peer:a", displayName: "Ann" },
        });

        // A fresh session must be able to read both with the password.
        fakeGoogleState.setCurrentUser("alice@example.com");
        const fresh = await factory({ currentUserEmail: "alice@example.com" });
        const snap = await fresh.openProject(ref, { password });

        const guest = snap.comments.find((c) => c.by === "peer:a");
        expect(guest?.body).toBe("Guest secret");
        expect(guest?.byName).toBe("Ann");
        const own = snap.comments.find((c) => c.by === "alice@example.com");
        expect(own?.body).toBe("Owner note");
      });
    });

    describe("option properties (v1.4.0)", () => {
      const OPT_A = "01J00000000000000000000001";
      const OPT_B = "01J00000000000000000000002";
      const COST = "org.example.cost";
      const STATUS = "org.decisionator.option-status";
      const options = [OPT_A, OPT_B].map((id, idx) => ({
        id,
        order: idx + 1,
        title: `Option ${idx + 1}`,
        description: "",
        status: "active" as const,
        tags: [],
        pros: [],
        cons: [],
        links: [],
        at: "2026-10-05T00:00:00Z",
        by: "alice@example.com",
      }));
      const cost = (value: number | null, optionId = OPT_A): Entry => ({
        kind: "property",
        optionId,
        plugin: COST,
        key: "cost",
        scope: "shared",
        value,
      });
      const seen = (value: string | null, optionId = OPT_A): Entry => ({
        kind: "property",
        optionId,
        plugin: STATUS,
        key: "seen",
        scope: "person",
        value,
      });

      async function ownerProject(password?: string) {
        fakeGoogleState.setCurrentUser("alice@example.com");
        const store = await factory({ currentUserEmail: "alice@example.com" });
        const ref = await store.createProject(
          { title: "Properties Project", options },
          password ? { password } : undefined
        );
        return { store, ref };
      }

      it("keeps the latest shared value per (plugin, key, option) and lets null clear it", async () => {
        const { store, ref } = await ownerProject();
        await store.append(ref, [cost(400)]);
        await store.append(ref, [cost(420), cost(90, OPT_B)]);

        let snap = await store.openProject(ref);
        const values = (snap.properties ?? []).filter((p) => p.plugin === COST);
        expect(values.map((p) => [p.optionId, p.value]).sort()).toEqual([
          [OPT_A, 420],
          [OPT_B, 90],
        ]);
        const a = values.find((p) => p.optionId === OPT_A);
        expect(a).toMatchObject({ key: "cost", scope: "shared", by: "alice@example.com" });
        expect(a?.id).toBeTruthy();
        expect(a?.at).toBeTruthy();

        await store.append(ref, [cost(null)]);
        snap = await store.openProject(ref);
        const cleared = (snap.properties ?? []).filter(
          (p) => p.plugin === COST && p.optionId === OPT_A
        );
        expect(cleared).toHaveLength(1);
        expect(cleared[0]?.value).toBeNull();
      });

      it("keeps one person value per author and records delegates under their own id", async () => {
        const { store, ref } = await ownerProject();
        await store.append(ref, [seen("seen_auto")]);
        await store.append(ref, [seen("seen_auto")], {
          onBehalfOf: { participantId: "peer:a", displayName: "Ann" },
        });
        await store.append(ref, [seen("not_seen")], {
          onBehalfOf: { participantId: "peer:a", displayName: "Ann" },
        });

        const snap = await store.openProject(ref);
        const values = (snap.properties ?? []).filter((p) => p.plugin === STATUS);
        expect(values.map((p) => [p.by, p.value]).sort()).toEqual([
          ["alice@example.com", "seen_auto"],
          ["peer:a", "not_seen"],
        ]);
        expect(values.find((p) => p.by === "peer:a")?.byName).toBe("Ann");
      });

      it("refuses delegated shared values and shared values from non-owners", async () => {
        const { store: alice, ref } = await ownerProject();
        await expect(
          alice.append(ref, [cost(1)], { onBehalfOf: { participantId: "peer:a" } })
        ).rejects.toThrow(/PERMISSION_DENIED/);

        await alice.share(ref, { inviteUsers: [{ email: "bob@example.com", role: "contribute" }] });
        fakeGoogleState.setCurrentUser("bob@example.com");
        const bob = await factory({ currentUserEmail: "bob@example.com" });
        await expect(bob.append(ref, [cost(2)])).rejects.toThrow(/PERMISSION_DENIED/);
        // A collaborator may still record their own person-scoped value.
        await bob.append(ref, [seen("seen")]);

        fakeGoogleState.setCurrentUser("alice@example.com");
        const snap = await alice.openProject(ref);
        expect((snap.properties ?? []).filter((p) => p.plugin === COST)).toHaveLength(0);
        expect(
          (snap.properties ?? []).find((p) => p.plugin === STATUS && p.by === "bob@example.com")
            ?.value
        ).toBe("seen");
      });

      it("refuses malformed entries, unknown options and values over 2 KiB, writing nothing", async () => {
        const { store, ref } = await ownerProject();
        const bad: Entry[] = [
          { ...(cost(1) as Extract<Entry, { kind: "property" }>), key: "Bad Key" },
          { ...(cost(1) as Extract<Entry, { kind: "property" }>), optionId: "no-such-option" },
          {
            ...(seen(null) as Extract<Entry, { kind: "property" }>),
            value: "x".repeat(2100),
          },
          {
            ...(seen(null) as Extract<Entry, { kind: "property" }>),
            value: { nested: true } as unknown as string,
          },
        ];
        for (const entry of bad) {
          await expect(store.append(ref, [cost(5, OPT_B), entry])).rejects.toThrow(
            /^INVALID_ARGUMENT/
          );
        }
        const snap = await store.openProject(ref);
        expect(snap.properties ?? []).toHaveLength(0);
      });

      it("returns values of plugins it does not know unchanged", async () => {
        const { store, ref } = await ownerProject();
        await store.append(ref, [
          {
            kind: "property",
            optionId: OPT_B,
            plugin: "com.thirdparty.unknown",
            key: "deadline",
            scope: "shared",
            value: "2026-12-31",
          },
        ]);
        const snap = await store.openProject(ref);
        expect(snap.properties?.[0]).toMatchObject({
          plugin: "com.thirdparty.unknown",
          key: "deadline",
          value: "2026-12-31",
        });
      });

      it("round-trips values on a password-protected project", async () => {
        const password = "correct-horse-battery-staple";
        const { store, ref } = await ownerProject(password);
        await store.openProject(ref, { password });
        await store.append(ref, [cost(420), seen("seen")]);

        fakeGoogleState.setCurrentUser("alice@example.com");
        const fresh = await factory({ currentUserEmail: "alice@example.com" });
        const snap = await fresh.openProject(ref, { password });
        expect(snap.properties?.find((p) => p.plugin === COST)?.value).toBe(420);
        expect(snap.properties?.find((p) => p.plugin === STATUS)?.value).toBe("seen");
      });
    });
  });
}
