import {
  type Comment,
  type Contribution,
  type Grade,
  type Option,
  type OutcomeRecord,
  type Project,
  type Ranking,
  checkVerifier,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  makeVerifier,
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
import { type IDBPDatabase, openDB } from "idb";

interface StoredFileProject {
  id: string;
  meta: {
    formatVersion: 2;
    title: string;
    description: string;
    protected: boolean;
    salt: string | null;
    iterations: number | null;
    verifier: string | null;
    voting: {
      state: "open" | "closed";
      round: number;
      topN: number;
      liveResults: boolean;
    };
    owner: string;
    createdAt: string;
    updatedAt: string;
  };
  options: Option[];
  grades: Grade[];
  comments: Comment[];
  rankings: Ranking[];
  outcomes: OutcomeRecord[];
  contributions: Contribution[];
  collaborators: {
    email: string;
    role: ParticipantRole;
  }[];
  trashed?: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b !== undefined) binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class FileProjectStore implements ProjectStore {
  readonly id = "org.decisionator.store.file";
  private dbPromise: Promise<IDBPDatabase>;
  private listeners = new Map<string, Set<(snapshot: ProjectSnapshot) => void>>();
  private handles = new Map<string, FileSystemFileHandle>();

  constructor(
    private currentUser = "local-user@device",
    dbName = "decisionator_file_store"
  ) {
    this.dbPromise = openDB(dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
      },
    });
  }

  setFileHandle(projectId: string, handle: FileSystemFileHandle): void {
    this.handles.set(projectId, handle);
  }

  getFileHandle(projectId: string): FileSystemFileHandle | undefined {
    return this.handles.get(projectId);
  }

  async signIn(): Promise<Identity> {
    return {
      participantId: this.currentUser,
      displayName: this.currentUser.split("@")[0] || this.currentUser,
      email: this.currentUser,
      role: "owner",
    };
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.dbPromise;
    const records: StoredFileProject[] = await db.getAll("projects");
    const summaries: ProjectSummary[] = [];

    for (const record of records) {
      if (record.trashed) continue;
      summaries.push({
        ref: { store: "file", id: record.id },
        title: record.meta.title,
        description: record.meta.description,
        owner: record.meta.owner,
        createdAt: record.meta.createdAt,
        updatedAt: record.meta.updatedAt,
        isProtected: record.meta.protected,
      });
    }
    return summaries;
  }

  async createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef> {
    const id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    let salt: string | null = null;
    let verifier: string | null = null;
    let iterations: number | null = null;

    let initialTitle = input.title;
    let initialDesc = input.description || "";
    let initialOptions: Option[] = (input.options || []).map((o, idx) => ({
      ...o,
      order: o.order ?? idx + 1,
      status: o.status ?? "active",
      tags: o.tags ?? [],
      pros: o.pros ?? [],
      cons: o.cons ?? [],
      links: o.links ?? [],
      at: o.at ?? now,
      by: this.currentUser,
    }));

    if (opts?.password) {
      const saltBytes = generateSalt();
      salt = bytesToBase64(saltBytes);
      iterations = 600000;

      const key = await deriveKey(opts.password, saltBytes, iterations);
      verifier = await makeVerifier(key);

      initialTitle = await encrypt(initialTitle, key);
      initialDesc = await encrypt(initialDesc, key);

      initialOptions = await Promise.all(
        initialOptions.map(async (opt) => ({
          ...opt,
          title: await encrypt(opt.title, key),
          description: await encrypt(opt.description, key),
        }))
      );
    }

    const doc: StoredFileProject = {
      id,
      meta: {
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
      },
      options: initialOptions,
      grades: [],
      comments: [],
      rankings: [],
      outcomes: [],
      contributions: [],
      collaborators: [{ email: this.currentUser, role: "owner" }],
    };

    const db = await this.dbPromise;
    await db.put("projects", doc);
    await this.syncToHandleIfAvailable(doc);

    return { store: "file", id };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
    if (!doc || doc.trashed) {
      throw new Error("Project unavailable or not found");
    }

    const role = this.resolveRole(doc, this.currentUser);

    if (doc.meta.protected) {
      if (!opts?.password) {
        throw new Error("Password required");
      }
      if (!doc.meta.salt || !doc.meta.iterations || !doc.meta.verifier) {
        throw new Error("Invalid encryption parameters");
      }
      const saltBytes = base64ToBytes(doc.meta.salt);
      const key = await deriveKey(opts.password, saltBytes, doc.meta.iterations);
      const valid = await checkVerifier(doc.meta.verifier, key);
      if (!valid) {
        throw new Error("Incorrect password");
      }

      // Decrypt
      const decryptedTitle = await decrypt(doc.meta.title, key);
      const decryptedDesc = await decrypt(doc.meta.description, key);
      const decryptedOptions = await Promise.all(
        doc.options.map(async (opt) => ({
          ...opt,
          title: await decrypt(opt.title, key),
          description: await decrypt(opt.description, key),
        }))
      );
      const decryptedComments = await Promise.all(
        doc.comments.map(async (c) => ({
          ...c,
          body: await decrypt(c.body, key),
        }))
      );

      return {
        project: {
          title: decryptedTitle,
          description: decryptedDesc,
          protected: true,
          formatVersion: 2,
          voting: { ...doc.meta.voting },
        },
        options: decryptedOptions,
        grades: [...doc.grades],
        comments: decryptedComments,
        rankings: [...doc.rankings],
        outcomes: [...doc.outcomes],
        contributions: [...doc.contributions],
        role,
      };
    }

    return {
      project: {
        title: doc.meta.title,
        description: doc.meta.description,
        protected: false,
        formatVersion: 2,
        voting: { ...doc.meta.voting },
      },
      options: [...doc.options],
      grades: [...doc.grades],
      comments: [...doc.comments],
      rankings: [...doc.rankings],
      outcomes: [...doc.outcomes],
      contributions: [...doc.contributions],
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
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role === "view") {
      throw new Error("PERMISSION_DENIED: View role cannot append");
    }

    const now = new Date().toISOString();
    let sentCount = 0;

    for (const e of entries) {
      if (e.kind === "grade") {
        // Latest wins per (by, optionId)
        doc.grades = doc.grades.filter(
          (g) => !(g.by === this.currentUser && g.optionId === e.optionId)
        );
        doc.grades.push({
          id: `grd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          optionId: e.optionId,
          value: e.value,
          by: this.currentUser,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "comment") {
        doc.comments.push({
          id: `cmt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          optionId: e.optionId,
          body: e.body,
          by: this.currentUser,
          at: now,
          hidden: e.hidden ?? false,
          replaces: e.replaces,
        });
        sentCount++;
      } else if (e.kind === "ranking") {
        const round = e.round ?? doc.meta.voting.round;
        doc.rankings = doc.rankings.filter(
          (r) => !(r.by === this.currentUser && r.round === round)
        );
        doc.rankings.push({
          id: `rnk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          ranking: [...e.ranking],
          by: this.currentUser,
          round,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "outcome") {
        doc.outcomes.push(e.outcome);
        sentCount++;
      } else if (e.kind === "contribution") {
        doc.contributions.push(e.contribution);
        sentCount++;
      }
    }

    doc.meta.updatedAt = now;
    await db.put("projects", doc);
    await this.syncToHandleIfAvailable(doc);
    await this.notifyListeners(ref);

    return { queued: 0, sent: sentCount };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update options");

    const now = new Date().toISOString();

    for (const op of ops) {
      if (op.op === "add") {
        doc.options.push({
          ...op.option,
          by: this.currentUser,
          at: now,
        });
      } else if (op.op === "update") {
        const idx = doc.options.findIndex((o) => o.id === op.option.id);
        if (idx >= 0 && doc.options[idx]) {
          doc.options[idx] = { ...doc.options[idx], ...op.option };
        }
      } else if (op.op === "remove") {
        const idx = doc.options.findIndex((o) => o.id === op.id);
        if (idx >= 0 && doc.options[idx]) {
          doc.options[idx].status = "removed";
        }
      }
    }

    doc.meta.updatedAt = now;
    await db.put("projects", doc);
    await this.syncToHandleIfAvailable(doc);
    await this.notifyListeners(ref);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update meta");

    if (patch.title !== undefined) doc.meta.title = patch.title;
    if (patch.description !== undefined) doc.meta.description = patch.description;
    if (patch.voting) doc.meta.voting = { ...doc.meta.voting, ...patch.voting };

    doc.meta.updatedAt = new Date().toISOString();
    await db.put("projects", doc);
    await this.syncToHandleIfAvailable(doc);
    await this.notifyListeners(ref);
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
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

    await db.put("projects", doc);
    return this.getShareState(ref);
  }

  async getShareState(ref: ProjectRef): Promise<ShareState> {
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    return {
      linkSharing: { enabled: false },
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
    const db = await this.dbPromise;
    const doc: StoredFileProject | undefined = await db.get("projects", ref.id);
    if (!doc || doc.trashed) throw new Error("Project unavailable or not found");

    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner can delete project");
    }

    doc.trashed = true;
    await db.put("projects", doc);
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    const db = await this.dbPromise;
    await db.delete("projects", ref.id);
    this.handles.delete(ref.id);
  }

  private resolveRole(doc: StoredFileProject, user: string): ParticipantRole {
    if (doc.meta.owner === user) return "owner";
    const found = doc.collaborators.find((c) => c.email === user);
    return found ? found.role : "view";
  }

  private async syncToHandleIfAvailable(doc: StoredFileProject): Promise<void> {
    const handle = this.handles.get(doc.id);
    if (handle && "createWritable" in handle) {
      try {
        const writable = await (
          handle as unknown as {
            createWritable: () => Promise<{
              write: (data: string) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }
        ).createWritable();
        const exportData = {
          format: "decisionator.project/v1",
          exportedAt: new Date().toISOString(),
          project: {
            title: doc.meta.title,
            description: doc.meta.description,
            protected: doc.meta.protected,
            formatVersion: 2,
            voting: doc.meta.voting,
          },
          options: doc.options,
          grades: doc.grades,
          comments: doc.comments,
          rankings: doc.rankings,
          outcomes: doc.outcomes,
          contributions: doc.contributions,
        };
        await writable.write(JSON.stringify(exportData, null, 2));
        await writable.close();
      } catch {
        // Fallback: handle write failure silently
      }
    }
  }
}
