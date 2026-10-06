import type {
  Comment,
  Contribution,
  Grade,
  Option,
  OutcomeRecord,
  Project,
  Ranking,
} from "@decisionator/core";
import type {
  AppendResult,
  Entry,
  ExportBundle,
  Identity,
  MetaPatch,
  NewProject,
  OptionOp,
  ParticipantRole,
  ProjectRef,
  ProjectSnapshot,
  ProjectStore,
  ProjectSummary,
  ShareRequest,
  ShareState,
  Unsubscribe,
} from "@decisionator/plugin-sdk";
import type { FirestoreEntryDoc, FirestoreOptionDoc, FirestoreProjectDoc } from "./collections.js";
import { decrypt, encrypt, setupPasswordProtection, verifyAndDerivePasswordKey } from "./crypto.js";

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

export class FirestoreProjectStore implements ProjectStore {
  readonly id = "org.decisionator.store.firestore";
  private listeners = new Map<string, Set<(snapshot: ProjectSnapshot) => void>>();

  // Internal memory collection cache (or Firestore simulation layer)
  private projects = new Map<string, FirestoreProjectDoc>();
  private options = new Map<string, Map<string, FirestoreOptionDoc>>();
  private entries = new Map<string, FirestoreEntryDoc[]>();

  constructor(
    private currentUser = "firebase-user@example.com",
    private config?: FirebaseConfig
  ) {}

  async signIn(): Promise<Identity> {
    return {
      participantId: this.currentUser,
      displayName: this.currentUser.split("@")[0] || this.currentUser,
      email: this.currentUser,
      role: "owner",
    };
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const summaries: ProjectSummary[] = [];
    for (const [id, doc] of this.projects.entries()) {
      if (doc.trashed) continue;
      summaries.push({
        ref: { store: "firestore", id },
        title: doc.title,
        description: doc.description,
        owner: doc.owner,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        isProtected: doc.protected,
      });
    }
    return summaries;
  }

  async createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef> {
    const id = `fs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    let salt: string | null = null;
    let verifier: string | null = null;
    let iterations: number | null = null;

    let initialTitle = input.title;
    let initialDesc = input.description || "";

    const projectOptions = new Map<string, FirestoreOptionDoc>();
    const inputOpts = input.options || [];

    if (opts?.password) {
      const p = await setupPasswordProtection(opts.password);
      salt = p.salt;
      verifier = p.verifier;
      iterations = p.iterations;

      initialTitle = await encrypt(initialTitle, p.key);
      initialDesc = await encrypt(initialDesc, p.key);

      for (const [idx, o] of inputOpts.entries()) {
        const encTitle = await encrypt(o.title, p.key);
        const encDesc = await encrypt(o.description || "", p.key);
        projectOptions.set(o.id, {
          ...o,
          order: o.order ?? idx + 1,
          status: o.status ?? "active",
          tags: o.tags ?? [],
          pros: o.pros ?? [],
          cons: o.cons ?? [],
          links: o.links ?? [],
          at: o.at ?? now,
          by: this.currentUser,
          title: encTitle,
          description: encDesc,
        });
      }
    } else {
      for (const [idx, o] of inputOpts.entries()) {
        projectOptions.set(o.id, {
          ...o,
          order: o.order ?? idx + 1,
          status: o.status ?? "active",
          tags: o.tags ?? [],
          pros: o.pros ?? [],
          cons: o.cons ?? [],
          links: o.links ?? [],
          at: o.at ?? now,
          by: this.currentUser,
        });
      }
    }

    const doc: FirestoreProjectDoc = {
      formatVersion: 2,
      title: initialTitle,
      description: initialDesc,
      protected: Boolean(opts?.password),
      salt,
      iterations,
      verifier,
      voting: input.voting || { state: "open", round: 1, topN: 3, liveResults: true },
      owner: this.currentUser,
      createdAt: now,
      updatedAt: now,
      collaborators: [{ email: this.currentUser, role: "owner" }],
    };

    this.projects.set(id, doc);
    this.options.set(id, projectOptions);
    this.entries.set(id, []);

    return { store: "firestore", id };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) {
      throw new Error("Project unavailable or not found");
    }

    const role = this.resolveRole(doc, this.currentUser);
    const optsMap = this.options.get(ref.id) || new Map();
    const entryList = this.entries.get(ref.id) || [];

    if (doc.protected) {
      if (!opts?.password) {
        throw new Error("Password required");
      }
      if (!doc.salt || !doc.iterations || !doc.verifier) {
        throw new Error("Invalid encryption parameters");
      }
      const key = await verifyAndDerivePasswordKey(
        opts.password,
        doc.salt,
        doc.iterations,
        doc.verifier
      );

      // Decrypt project
      const decryptedTitle = await decrypt(doc.title, key);
      const decryptedDesc = await decrypt(doc.description, key);

      const decryptedOptions: Option[] = [];
      for (const opt of optsMap.values()) {
        decryptedOptions.push({
          ...opt,
          title: await decrypt(opt.title, key),
          description: await decrypt(opt.description, key),
        });
      }

      const { grades, comments, rankings, outcomes, contributions } = this.buildEntries(
        entryList,
        doc.voting.round
      );

      // Decrypt comments if encrypted
      const decryptedComments = await Promise.all(
        comments.map(async (c) => {
          try {
            return { ...c, body: await decrypt(c.body, key) };
          } catch {
            return c;
          }
        })
      );

      return {
        project: {
          title: decryptedTitle,
          description: decryptedDesc,
          protected: true,
          formatVersion: 2,
          voting: { ...doc.voting },
        },
        options: decryptedOptions,
        grades,
        comments: decryptedComments,
        rankings,
        outcomes,
        contributions,
        role,
      };
    }

    const { grades, comments, rankings, outcomes, contributions } = this.buildEntries(
      entryList,
      doc.voting.round
    );

    return {
      project: {
        title: doc.title,
        description: doc.description,
        protected: false,
        formatVersion: 2,
        voting: { ...doc.voting },
      },
      options: Array.from(optsMap.values()),
      grades,
      comments,
      rankings,
      outcomes,
      contributions,
      role,
    };
  }

  watch(ref: ProjectRef, onChange: (s: ProjectSnapshot) => void): Unsubscribe {
    let set = this.listeners.get(ref.id);
    if (!set) {
      set = new Set();
      this.listeners.set(ref.id, set);
    }
    set.add(onChange);
    return () => {
      set?.delete(onChange);
    };
  }

  private async notifyListeners(ref: ProjectRef): Promise<void> {
    const set = this.listeners.get(ref.id);
    if (set && set.size > 0) {
      try {
        const snap = await this.openProject(ref);
        for (const listener of set) {
          listener(snap);
        }
      } catch {
        // Listener error ignored
      }
    }
  }

  async append(ref: ProjectRef, entries: Entry[]): Promise<AppendResult> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role === "view") {
      throw new Error("PERMISSION_DENIED: View role cannot append");
    }

    const now = new Date().toISOString();
    const entryList = this.entries.get(ref.id) || [];
    let sentCount = 0;

    for (const e of entries) {
      const entryId = `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      if (e.kind === "grade") {
        entryList.push({
          id: entryId,
          kind: "grade",
          optionId: e.optionId,
          value: e.value,
          by: this.currentUser,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "comment") {
        entryList.push({
          id: entryId,
          kind: "comment",
          optionId: e.optionId,
          body: e.body,
          by: this.currentUser,
          at: now,
          hidden: e.hidden,
          replaces: e.replaces,
        });
        sentCount++;
      } else if (e.kind === "ranking") {
        entryList.push({
          id: entryId,
          kind: "ranking",
          ranking: [...e.ranking],
          round: e.round ?? doc.voting.round,
          by: this.currentUser,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "outcome") {
        entryList.push({
          id: entryId,
          kind: "outcome",
          outcome: e.outcome,
          by: this.currentUser,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "contribution") {
        entryList.push({
          id: entryId,
          kind: "contribution",
          contribution: e.contribution,
          by: this.currentUser,
          at: now,
        });
        sentCount++;
      }
    }

    this.entries.set(ref.id, entryList);
    doc.updatedAt = now;
    await this.notifyListeners(ref);

    return { queued: 0, sent: sentCount };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update options");

    const now = new Date().toISOString();
    const optsMap = this.options.get(ref.id) || new Map();

    for (const op of ops) {
      if (op.op === "add") {
        optsMap.set(op.option.id, {
          ...op.option,
          by: this.currentUser,
          at: now,
        });
      } else if (op.op === "update") {
        const existing = optsMap.get(op.option.id);
        if (existing) {
          optsMap.set(op.option.id, { ...existing, ...op.option });
        }
      } else if (op.op === "remove") {
        const existing = optsMap.get(op.id);
        if (existing) {
          existing.status = "removed";
        }
      }
    }

    doc.updatedAt = now;
    await this.notifyListeners(ref);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update meta");

    if (patch.title !== undefined) doc.title = patch.title;
    if (patch.description !== undefined) doc.description = patch.description;
    if (patch.voting) doc.voting = { ...doc.voting, ...patch.voting };

    doc.updatedAt = new Date().toISOString();
    await this.notifyListeners(ref);
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    if (req.inviteUsers) {
      for (const invite of req.inviteUsers) {
        const existing = doc.collaborators.find((c) => c.email === invite.email);
        if (existing) {
          existing.role = invite.role;
        } else {
          doc.collaborators.push({ email: invite.email, role: invite.role });
        }
      }
    }

    if (req.removeUsers) {
      doc.collaborators = doc.collaborators.filter((c) => !req.removeUsers?.includes(c.email));
    }

    return this.getShareState(ref);
  }

  async getShareState(ref: ProjectRef): Promise<ShareState> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    return {
      linkSharing: { enabled: true, role: "contribute" },
      collaborators: doc.collaborators.map((c) => ({
        email: c.email,
        role: c.role,
      })),
    };
  }

  async export(ref: ProjectRef): Promise<ExportBundle> {
    const snapshot = await this.openProject(ref);
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot,
    };
  }

  async deleteProject(ref: ProjectRef): Promise<void> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can delete project");

    doc.trashed = true;
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    this.projects.delete(ref.id);
    this.options.delete(ref.id);
    this.entries.delete(ref.id);
  }

  private resolveRole(doc: FirestoreProjectDoc, user: string): ParticipantRole {
    if (doc.owner === user) return "owner";
    const found = doc.collaborators.find((c) => c.email === user);
    return found ? found.role : "view";
  }

  private buildEntries(entryList: FirestoreEntryDoc[], currentRound: number) {
    const grades: Grade[] = [];
    const comments: Comment[] = [];
    const rankings: Ranking[] = [];
    const outcomes: OutcomeRecord[] = [];
    const contributions: Contribution[] = [];

    // Latest-wins map for grades: key = `${by}:${optionId}`
    const latestGrades = new Map<string, Grade>();
    // Latest-wins map for rankings: key = `${by}:${round}`
    const latestRankings = new Map<string, Ranking>();

    for (const e of entryList) {
      if (e.kind === "grade") {
        latestGrades.set(`${e.by}:${e.optionId}`, {
          id: e.id,
          optionId: e.optionId,
          value: e.value,
          by: e.by,
          at: e.at,
        });
      } else if (e.kind === "comment") {
        comments.push({
          id: e.id,
          optionId: e.optionId,
          body: e.body,
          by: e.by,
          at: e.at,
          hidden: e.hidden ?? false,
          replaces: e.replaces,
        });
      } else if (e.kind === "ranking") {
        latestRankings.set(`${e.by}:${e.round}`, {
          id: e.id,
          ranking: e.ranking,
          by: e.by,
          round: e.round,
          at: e.at,
        });
      } else if (e.kind === "outcome") {
        outcomes.push(e.outcome);
      } else if (e.kind === "contribution") {
        contributions.push(e.contribution);
      }
    }

    return {
      grades: Array.from(latestGrades.values()),
      comments,
      rankings: Array.from(latestRankings.values()),
      outcomes,
      contributions,
    };
  }
}
