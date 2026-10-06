import * as A from "@automerge/automerge";
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
  resolveDelegatedAuthor,
} from "@decisionator/plugin-sdk";
import { type IDBPDatabase, openDB } from "idb";

const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * Text fields of protected projects are stored encrypted. An empty value (e.g. the body of a
 * hide/unhide toggle comment) is stored as-is, and values written in plaintext by older versions
 * are read back unchanged instead of making the whole project unreadable.
 */
async function openSealed(value: string, key: CryptoKey): Promise<string> {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  return decrypt(value, key);
}

async function encryptCommentBody(body: string, key: CryptoKey): Promise<string> {
  return body === "" ? "" : encrypt(body, key);
}

export interface AutomergeProjectDoc {
  [key: string]: unknown;
  meta: {
    formatVersion: 1;
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

export class LocalProjectStore implements ProjectStore {
  readonly id = "org.decisionator.store.local";
  private dbPromise: Promise<IDBPDatabase>;
  private listeners = new Map<string, Set<(snapshot: ProjectSnapshot) => void>>();
  /** Keys of protected projects unlocked in this session, by project id. Memory only. */
  private keys = new Map<string, CryptoKey>();
  /** Tail of the per-project mutation chain; serializes read-modify-write cycles. */
  private locks = new Map<string, Promise<void>>();

  constructor(
    private currentUser = "local-user@device",
    dbName = "decisionator_local_store"
  ) {
    this.dbPromise = openDB(dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("docs")) {
          db.createObjectStore("docs", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("trashed")) {
          db.createObjectStore("trashed", { keyPath: "id" });
        }
      },
    });
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
    const records = await db.getAll("docs");
    const summaries: ProjectSummary[] = [];

    for (const record of records) {
      try {
        const doc = A.load<AutomergeProjectDoc>(record.bytes);
        summaries.push({
          ref: { store: "local", id: record.id },
          title: doc.meta.title,
          description: doc.meta.description,
          owner: doc.meta.owner,
          createdAt: doc.meta.createdAt,
          isProtected: doc.meta.protected,
        });
      } catch {
        // Skip unparseable doc
      }
    }
    return summaries;
  }

  async createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef> {
    const id = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    let saltB64: string | null = null;
    let verifier: string | null = null;
    let iterations: number | null = null;

    let initialTitle = input.title;
    let initialDesc = input.description || "";
    let initialOptions: Option[] = (input.options || []).map((o, idx) => ({
      ...o,
      description: o.description || "",
      tags: o.tags || [],
      pros: o.pros || [],
      cons: o.cons || [],
      links: o.links || [],
      order: o.order ?? idx + 1,
    }));

    if (opts?.password) {
      const salt = generateSalt();
      const iter = 600_000;
      const cryptoKey = await deriveKey(opts.password, salt, iter);
      saltB64 = bytesToBase64(salt);
      verifier = await makeVerifier(cryptoKey);
      iterations = iter;

      initialTitle = await encrypt(input.title, cryptoKey);
      initialDesc = input.description ? await encrypt(input.description, cryptoKey) : "";
      initialOptions = await Promise.all(
        initialOptions.map(async (opt) => ({
          ...opt,
          title: await encrypt(opt.title, cryptoKey),
          description: await encrypt(opt.description, cryptoKey),
          pros: await Promise.all(opt.pros.map((p) => encrypt(p, cryptoKey))),
          cons: await Promise.all(opt.cons.map((c) => encrypt(c, cryptoKey))),
        }))
      );
    }

    const initialDoc: AutomergeProjectDoc = {
      meta: {
        formatVersion: 1,
        title: initialTitle,
        description: initialDesc,
        protected: Boolean(opts?.password),
        salt: saltB64,
        iterations,
        verifier,
        voting: input.voting ?? { state: "open", round: 1, topN: 3, liveResults: true },
        owner: this.currentUser,
        createdAt: now,
      },
      options: initialOptions,
      grades: [],
      comments: [],
      rankings: [],
      outcomes: [],
      contributions: [],
      collaborators: [{ email: this.currentUser, role: "owner" }],
    };

    const doc = A.from(initialDoc as unknown as Record<string, unknown>);
    const bytes = A.save(doc);

    const db = await this.dbPromise;
    await db.put("docs", { id, bytes, updatedAt: now });

    return { store: "local", id };
  }

  private async loadDoc(id: string): Promise<A.Doc<AutomergeProjectDoc>> {
    const db = await this.dbPromise;
    const isTrashed = await db.get("trashed", id);
    if (isTrashed) {
      throw new Error("Project unavailable or deleted");
    }

    const record = await db.get("docs", id);
    if (!record) {
      throw new Error("Project unavailable or not found");
    }
    return A.load<AutomergeProjectDoc>(record.bytes);
  }

  private async saveDoc(id: string, doc: A.Doc<AutomergeProjectDoc>): Promise<void> {
    const bytes = A.save(doc);
    const db = await this.dbPromise;
    await db.put("docs", { id, bytes, updatedAt: new Date().toISOString() });
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const doc = await this.loadDoc(ref.id);

    let finalTitle = doc.meta.title;
    let finalDesc = doc.meta.description;
    let finalOptions: Option[] = doc.options;
    let finalComments: Comment[] = doc.comments;

    if (doc.meta.protected) {
      const cryptoKey = await this.unlock(ref.id, doc, opts?.password);
      finalTitle = await openSealed(finalTitle, cryptoKey);
      finalDesc = await openSealed(finalDesc, cryptoKey);
      finalOptions = await Promise.all(
        doc.options.map(async (o) => ({
          ...o,
          title: await openSealed(o.title, cryptoKey),
          description: await openSealed(o.description, cryptoKey),
          pros: await Promise.all(o.pros.map((p) => openSealed(p, cryptoKey))),
          cons: await Promise.all(o.cons.map((c) => openSealed(c, cryptoKey))),
        }))
      );
      finalComments = await Promise.all(
        doc.comments.map(async (c) => ({ ...c, body: await openSealed(c.body, cryptoKey) }))
      );
    }

    // Role
    let role: ParticipantRole = "view";
    if (doc.meta.owner === this.currentUser) {
      role = "owner";
    } else {
      const match = doc.collaborators.find((c) => c.email === this.currentUser);
      if (match) role = match.role;
    }

    return {
      project: {
        title: finalTitle,
        description: finalDesc,
        protected: doc.meta.protected,
        voting: doc.meta.voting,
        formatVersion: 1,
      },
      options: finalOptions,
      grades: doc.grades,
      comments: finalComments,
      rankings: doc.rankings,
      outcomes: doc.outcomes,
      contributions: doc.contributions,
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

  private async notify(ref: ProjectRef): Promise<void> {
    const set = this.listeners.get(ref.id);
    if (set && set.size > 0) {
      try {
        const snap = await this.openProject(ref);
        for (const cb of set) cb(snap);
      } catch {
        // Ignored
      }
    }
  }

  async append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult> {
    await this.mutate(ref.id, async (doc) => {
      const role =
        doc.meta.owner === this.currentUser
          ? "owner"
          : (doc.collaborators.find((c) => c.email === this.currentUser)?.role ?? "view");

      if (role === "view") {
        throw new Error("PERMISSION_DENIED: View role cannot append");
      }
      // Validates the whole call before anything is written.
      const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
      const by = delegated?.by ?? this.currentUser;
      // Automerge rejects `undefined` values, so the key is omitted when there is no name.
      const byName = delegated?.byName !== undefined ? { byName: delegated.byName } : {};

      // Protected projects keep comment bodies encrypted, so writes need the session key.
      // `A.change` is synchronous, so bodies are sealed up front.
      const key = doc.meta.protected ? this.requireKey(ref.id) : undefined;
      const bodies = await Promise.all(
        entries.map((e) => (e.kind === "comment" && key ? encryptCommentBody(e.body, key) : null))
      );

      const now = new Date().toISOString();

      return A.change(doc, (d) => {
        for (const [i, entry] of entries.entries()) {
          if (entry.kind === "grade") {
            // Latest wins per (by, optionId)
            const idx = d.grades.findIndex((g) => g.by === by && g.optionId === entry.optionId);
            const newGrade: Grade = {
              id: `g_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              optionId: entry.optionId,
              value: entry.value,
              by,
              ...byName,
              at: now,
            };
            if (idx !== -1) {
              d.grades[idx] = newGrade;
            } else {
              d.grades.push(newGrade);
            }
          } else if (entry.kind === "comment") {
            const newComment: Comment = {
              id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              optionId: entry.optionId,
              body: bodies[i] ?? entry.body,
              by,
              ...byName,
              at: now,
              ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
              ...(entry.replaces !== undefined ? { replaces: entry.replaces } : {}),
            };
            d.comments.push(newComment);
          } else if (entry.kind === "ranking") {
            // Latest wins per (by, round)
            const round = entry.round ?? d.meta.voting.round;
            const idx = d.rankings.findIndex((r) => r.by === by && r.round === round);
            const newRanking: Ranking = {
              id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              ranking: entry.ranking,
              round,
              by,
              ...byName,
              at: now,
            };
            if (idx !== -1) {
              d.rankings[idx] = newRanking;
            } else {
              d.rankings.push(newRanking);
            }
          } else if (entry.kind === "outcome") {
            d.outcomes.push(entry.outcome);
          } else if (entry.kind === "contribution") {
            d.contributions.push(entry.contribution);
          }
        }
      });
    });

    await this.notify(ref);
    return { queued: 0, sent: entries.length };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    await this.mutate(ref.id, async (doc) => {
      if (doc.meta.owner !== this.currentUser) {
        throw new Error("PERMISSION_DENIED: Only owner can update options");
      }

      // Protected projects keep option text encrypted, so edits need the session key.
      // `A.change` is synchronous, so options are sealed up front.
      const key = doc.meta.protected ? this.requireKey(ref.id) : undefined;
      const seal = async <T extends Partial<Option>>(o: T): Promise<T> => {
        if (!key) return o;
        const sealed = { ...o };
        if (typeof o.title === "string") sealed.title = await encrypt(o.title, key);
        if (typeof o.description === "string") {
          sealed.description = await encrypt(o.description, key);
        }
        if (o.pros) sealed.pros = await Promise.all(o.pros.map((p) => encrypt(p, key)));
        if (o.cons) sealed.cons = await Promise.all(o.cons.map((c) => encrypt(c, key)));
        return sealed;
      };
      const sealedOps = await Promise.all(
        ops.map(async (op): Promise<OptionOp> => {
          if (op.op === "add") return { ...op, option: await seal(op.option) };
          if (op.op === "update") return { ...op, option: await seal(op.option) };
          return op;
        })
      );

      return A.change(doc, (d) => {
        for (const op of sealedOps) {
          if (op.op === "add") {
            d.options.push(op.option);
          } else if (op.op === "update") {
            const current = d.options.find((o) => o.id === op.option.id);
            if (current) {
              // Assigned field by field: spreading `current` would re-insert its Automerge
              // objects (tags, links …), which Automerge rejects, and it rejects `undefined`.
              const target = current as unknown as Record<string, unknown>;
              for (const [field, value] of Object.entries(op.option)) {
                if (value !== undefined) target[field] = value;
              }
            }
          } else if (op.op === "remove") {
            const idx = d.options.findIndex((o) => o.id === op.id);
            if (idx !== -1) {
              d.options.splice(idx, 1);
            }
          }
        }
      });
    });
    await this.notify(ref);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    await this.mutate(ref.id, async (doc) => {
      if (doc.meta.owner !== this.currentUser) {
        throw new Error("PERMISSION_DENIED: Only owner can update metadata");
      }

      const key = doc.meta.protected ? this.requireKey(ref.id) : undefined;
      const seal = (value: string | undefined) =>
        value !== undefined && key ? encrypt(value, key) : value;
      const title = await seal(patch.title);
      const description = await seal(patch.description);

      return A.change(doc, (d) => {
        if (title !== undefined) d.meta.title = title;
        if (description !== undefined) d.meta.description = description;
        if (patch.voting) {
          d.meta.voting = { ...d.meta.voting, ...patch.voting };
        }
      });
    });
    await this.notify(ref);
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    await this.mutate(ref.id, async (doc) => {
      if (doc.meta.owner !== this.currentUser) {
        throw new Error("PERMISSION_DENIED: Only owner can manage sharing");
      }

      return A.change(doc, (d) => {
        if (req.inviteUsers) {
          for (const inv of req.inviteUsers) {
            const existing = d.collaborators.find((c) => c.email === inv.email);
            if (existing) {
              existing.role = inv.role;
            } else {
              d.collaborators.push({ email: inv.email, role: inv.role });
            }
          }
        }
        if (req.removeUsers) {
          for (const rem of req.removeUsers) {
            const idx = d.collaborators.findIndex((c) => c.email === rem);
            if (idx !== -1) d.collaborators.splice(idx, 1);
          }
        }
      });
    });
    return this.getShareState(ref);
  }

  async getShareState(ref: ProjectRef): Promise<ShareState> {
    const doc = await this.loadDoc(ref.id);
    return {
      linkSharing: { enabled: false },
      collaborators: doc.collaborators,
    };
  }

  async export(ref: ProjectRef): Promise<ExportBundle> {
    const snap = await this.openProject(ref);
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: snap,
    };
  }

  async deleteProject(ref: ProjectRef): Promise<void> {
    await this.withLock(ref.id, async () => {
      const doc = await this.loadDoc(ref.id);
      if (doc.meta.owner !== this.currentUser) {
        throw new Error("PERMISSION_DENIED: Only owner can delete project");
      }

      const db = await this.dbPromise;
      await db.put("trashed", { id: ref.id, trashedAt: new Date().toISOString() });
      await db.delete("docs", ref.id);
    });
    this.keys.delete(ref.id);
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    await this.withLock(ref.id, async () => {
      const db = await this.dbPromise;
      await db.delete("docs", ref.id);
    });
    this.keys.delete(ref.id);
  }

  /**
   * Returns the key for a protected project: derived from `password` (and remembered for the
   * session) when given, otherwise the key remembered from an earlier unlock.
   */
  private async unlock(
    projectId: string,
    doc: A.Doc<AutomergeProjectDoc>,
    password?: string
  ): Promise<CryptoKey> {
    if (!doc.meta.salt || !doc.meta.verifier) {
      throw new Error("Corrupted protected project meta");
    }
    if (!password) {
      const cached = this.keys.get(projectId);
      if (cached && (await checkVerifier(doc.meta.verifier, cached))) return cached;
      this.keys.delete(projectId);
      throw new Error("Password required");
    }
    const salt = base64ToBytes(doc.meta.salt);
    const key = await deriveKey(password, salt, doc.meta.iterations || 600_000);
    if (!(await checkVerifier(doc.meta.verifier, key))) {
      throw new Error("Incorrect password");
    }
    this.keys.set(projectId, key);
    return key;
  }

  private requireKey(projectId: string): CryptoKey {
    const key = this.keys.get(projectId);
    if (!key) throw new Error("Password required");
    return key;
  }

  /** Runs `fn` after every earlier mutation of the same project has settled. */
  private withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(projectId, tail);
    void tail.then(() => {
      if (this.locks.get(projectId) === tail) this.locks.delete(projectId);
    });
    return run;
  }

  /** Serialized load-change-save cycle of one live project document. */
  private mutate(
    projectId: string,
    fn: (doc: A.Doc<AutomergeProjectDoc>) => Promise<A.Doc<AutomergeProjectDoc>>
  ): Promise<void> {
    return this.withLock(projectId, async () => {
      const doc = await fn(await this.loadDoc(projectId));
      await this.saveDoc(projectId, doc);
    });
  }
}
