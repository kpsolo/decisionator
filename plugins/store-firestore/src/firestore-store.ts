import type {
  Comment,
  Contribution,
  Grade,
  Option,
  OutcomeRecord,
  Project,
  Ranking,
} from "@decisionator/core";
import {
  type AppendOptions,
  type AppendResult,
  type Entry,
  type ExportBundle,
  type Identity,
  type MetaPatch,
  type NewProject,
  type OptionOp,
  type ParticipantRole,
  type ProjectRef,
  type ProjectSnapshot,
  type ProjectStore,
  type ProjectSummary,
  type ShareRequest,
  type ShareState,
  type Unsubscribe,
  readStoredByName,
  resolveDelegatedAuthor,
} from "@decisionator/plugin-sdk";
import type { FirestoreEntryDoc, FirestoreOptionDoc, FirestoreProjectDoc } from "./collections.js";
import {
  checkVerifier,
  decrypt,
  encrypt,
  setupPasswordProtection,
  verifyAndDerivePasswordKey,
} from "./crypto.js";

const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * Text fields of protected projects are stored encrypted. An empty value (e.g. the body of a
 * hide/unhide toggle comment) is stored as-is, and values written in plaintext by older versions
 * are read back unchanged instead of making the whole project unreadable. Ciphertext that does
 * not decrypt is an error, never returned as text.
 */
async function openSealed(value: string, key: CryptoKey): Promise<string> {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  return decrypt(value, key);
}

async function encryptCommentBody(body: string, key: CryptoKey): Promise<string> {
  return body === "" ? "" : encrypt(body, key);
}

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
  /** Keys of protected projects unlocked in this session, by project id. Memory only. */
  private keys = new Map<string, CryptoKey>();

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
      const key = await this.unlock(ref.id, doc, opts?.password);

      // Decrypt project
      const decryptedTitle = await openSealed(doc.title, key);
      const decryptedDesc = await openSealed(doc.description, key);

      const decryptedOptions: Option[] = [];
      for (const opt of optsMap.values()) {
        decryptedOptions.push({
          ...opt,
          title: await openSealed(opt.title, key),
          description: await openSealed(opt.description, key),
        });
      }

      const { grades, comments, rankings, outcomes, contributions } = this.buildEntries(
        entryList,
        doc.voting.round
      );

      const decryptedComments = await Promise.all(
        comments.map(async (c) => ({ ...c, body: await openSealed(c.body, key) }))
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

  async append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role === "view") {
      throw new Error("PERMISSION_DENIED: View role cannot append");
    }
    // Validates the whole call before anything is written.
    const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
    const by = delegated?.by ?? this.currentUser;
    const byName = delegated?.byName !== undefined ? { byName: delegated.byName } : {};

    // Protected projects keep comment bodies encrypted, so writes need the session key.
    // Bodies are sealed before anything is written, so a failure leaves no partial append.
    const key = doc.protected ? this.requireKey(ref.id) : undefined;
    const bodies = await Promise.all(
      entries.map((e) => (e.kind === "comment" && key ? encryptCommentBody(e.body, key) : null))
    );

    const now = new Date().toISOString();
    const entryList = this.entries.get(ref.id) || [];
    let sentCount = 0;

    for (const [i, e] of entries.entries()) {
      const entryId = `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      if (e.kind === "grade") {
        entryList.push({
          id: entryId,
          kind: "grade",
          optionId: e.optionId,
          value: e.value,
          by,
          ...byName,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "comment") {
        entryList.push({
          id: entryId,
          kind: "comment",
          optionId: e.optionId,
          body: bodies[i] ?? e.body,
          by,
          ...byName,
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
          by,
          ...byName,
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

    // Protected projects keep option text encrypted, so edits need the session key.
    const key = doc.protected ? this.requireKey(ref.id) : undefined;
    const seal = async <T extends Partial<Option>>(o: T): Promise<T> => {
      if (!key) return o;
      const sealed = { ...o };
      if (typeof o.title === "string") sealed.title = await encrypt(o.title, key);
      if (typeof o.description === "string") {
        sealed.description = await encrypt(o.description, key);
      }
      return sealed;
    };
    // Sealed before anything is written, so a failure leaves no partial update.
    const sealedOps = await Promise.all(
      ops.map(async (op): Promise<OptionOp> => {
        if (op.op === "add") return { ...op, option: await seal(op.option) };
        if (op.op === "update") return { ...op, option: await seal(op.option) };
        return op;
      })
    );

    const now = new Date().toISOString();
    const optsMap = this.options.get(ref.id) || new Map();

    for (const op of sealedOps) {
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

    const key = doc.protected ? this.requireKey(ref.id) : undefined;
    const seal = (value: string | undefined) =>
      value !== undefined && key ? encrypt(value, key) : value;
    const title = await seal(patch.title);
    const description = await seal(patch.description);

    if (title !== undefined) doc.title = title;
    if (description !== undefined) doc.description = description;
    if (patch.voting) doc.voting = { ...doc.voting, ...patch.voting };

    doc.updatedAt = new Date().toISOString();
    await this.notifyListeners(ref);
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    const doc = this.projects.get(ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can manage sharing");

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
    this.keys.delete(ref.id);
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    this.projects.delete(ref.id);
    this.options.delete(ref.id);
    this.entries.delete(ref.id);
    this.keys.delete(ref.id);
  }

  /**
   * Returns the key for a protected project: derived from `password` (and remembered for the
   * session) when given, otherwise the key remembered from an earlier unlock.
   */
  private async unlock(
    projectId: string,
    doc: FirestoreProjectDoc,
    password?: string
  ): Promise<CryptoKey> {
    if (!doc.salt || !doc.iterations || !doc.verifier) {
      throw new Error("Invalid encryption parameters");
    }
    if (!password) {
      const cached = this.keys.get(projectId);
      if (cached && (await checkVerifier(doc.verifier, cached))) return cached;
      this.keys.delete(projectId);
      throw new Error("Password required");
    }
    const key = await verifyAndDerivePasswordKey(password, doc.salt, doc.iterations, doc.verifier);
    this.keys.set(projectId, key);
    return key;
  }

  private requireKey(projectId: string): CryptoKey {
    const key = this.keys.get(projectId);
    if (!key) throw new Error("Password required");
    return key;
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

    // Latest-wins map for grades, keyed on (by, optionId). JSON keys keep ids that contain ':'
    // (e.g. "peer:a") from colliding.
    const latestGrades = new Map<string, Grade>();
    // Latest-wins map for rankings, keyed on (by, round)
    const latestRankings = new Map<string, Ranking>();
    const nameOf = (value: unknown) => {
      const byName = readStoredByName(value);
      return byName === undefined ? {} : { byName };
    };

    for (const e of entryList) {
      if (e.kind === "grade") {
        latestGrades.set(JSON.stringify([e.by, e.optionId]), {
          id: e.id,
          optionId: e.optionId,
          value: e.value,
          by: e.by,
          ...nameOf(e.byName),
          at: e.at,
        });
      } else if (e.kind === "comment") {
        comments.push({
          id: e.id,
          optionId: e.optionId,
          body: e.body,
          by: e.by,
          ...nameOf(e.byName),
          at: e.at,
          hidden: e.hidden ?? false,
          replaces: e.replaces,
        });
      } else if (e.kind === "ranking") {
        latestRankings.set(JSON.stringify([e.by, e.round]), {
          id: e.id,
          ranking: e.ranking,
          by: e.by,
          ...nameOf(e.byName),
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
