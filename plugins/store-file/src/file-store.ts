import {
  type Comment,
  type Contribution,
  type Grade,
  type Option,
  type OutcomeRecord,
  type Project,
  type PropertyValue,
  type Ranking,
  type Reset,
  checkVerifier,
  decrypt,
  deriveKey,
  effectiveEntries,
  encrypt,
  generateSalt,
  makeVerifier,
  monotonicNow,
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
  applyStrategyPatch,
  checkPropertyEntries,
  checkResetEntries,
  propertyRecord,
  resetRecord,
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

/** Property values of protected projects are stored as an encrypted JSON string. */
async function sealPropertyValue(
  value: PropertyValue["value"],
  key: CryptoKey | undefined
): Promise<PropertyValue["value"]> {
  return key ? encrypt(JSON.stringify(value), key) : value;
}

async function openPropertyValue(
  value: PropertyValue["value"],
  key: CryptoKey
): Promise<PropertyValue["value"]> {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  return JSON.parse(await decrypt(value, key)) as PropertyValue["value"];
}

/**
 * The chosen strategy as stored. In a protected project the settings are kept as an encrypted
 * JSON string in `sealedSettings`, like the title.
 */
interface StoredStrategy {
  id: string;
  version: string;
  at: string;
  by: string;
  settings?: Record<string, unknown>;
  sealedSettings?: string;
}

type ProjectStrategy = NonNullable<Project["strategy"]>;

async function sealStrategy(
  strategy: ProjectStrategy,
  key: CryptoKey | undefined
): Promise<StoredStrategy> {
  const stamp = {
    id: strategy.id,
    version: strategy.version,
    at: strategy.at ?? "",
    by: strategy.by ?? "",
  };
  return key
    ? { ...stamp, sealedSettings: await encrypt(JSON.stringify(strategy.settings), key) }
    : { ...stamp, settings: strategy.settings };
}

async function openStrategy(
  stored: StoredStrategy,
  key: CryptoKey | undefined
): Promise<ProjectStrategy> {
  let settings = stored.settings ?? {};
  if (stored.sealedSettings !== undefined) {
    if (!key) throw new Error("Password required");
    settings = JSON.parse(await decrypt(stored.sealedSettings, key)) as Record<string, unknown>;
  }
  return { id: stored.id, version: stored.version, settings, at: stored.at, by: stored.by };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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
    /** Chosen strategy (ProjectStore v1.4.0). Missing in older docs. */
    strategy?: StoredStrategy;
    /** The last 20 strategy changes, oldest first. */
    strategyChanges?: { id: string; at: string; by: string }[];
  };
  options: Option[];
  grades: Grade[];
  comments: Comment[];
  rankings: Ranking[];
  outcomes: OutcomeRecord[];
  contributions: Contribution[];
  /**
   * Grades, rankings and properties keep every entry in append order (ProjectStore v1.4.0);
   * latest-wins and resets are applied when the snapshot is built. Older docs kept only the
   * latest entry per slot, which reads back the same.
   */
  properties?: PropertyValue[];
  /** Reset entries in append order (ProjectStore v1.4.0). Missing in older docs. */
  resets?: Reset[];
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
  /** Keys of protected projects unlocked in this session, by project id. Memory only. */
  private keys = new Map<string, CryptoKey>();
  /** Tail of the per-project mutation chain; serializes read-modify-write cycles. */
  private locks = new Map<string, Promise<void>>();

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
      properties: [],
      resets: [],
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
    const key = doc.meta.protected ? await this.unlock(doc, opts?.password) : undefined;
    const open = (value: string) => (key ? openSealed(value, key) : Promise.resolve(value));

    const options = key
      ? await Promise.all(
          doc.options.map(async (opt) => ({
            ...opt,
            title: await openSealed(opt.title, key),
            description: await openSealed(opt.description, key),
          }))
        )
      : [...doc.options];
    const comments = await Promise.all(
      doc.comments.map(async (c) => ({ ...c, body: await open(c.body) }))
    );
    const properties = await Promise.all(
      (doc.properties ?? []).map(async (p) =>
        key ? { ...p, value: await openPropertyValue(p.value, key) } : { ...p }
      )
    );
    // Latest wins and resets, with the superseded and cleared entries as history.
    const effective = effectiveEntries({
      grades: doc.grades,
      rankings: doc.rankings,
      properties,
      resets: doc.resets ?? [],
    });

    return {
      project: {
        title: await open(doc.meta.title),
        description: await open(doc.meta.description),
        protected: doc.meta.protected,
        formatVersion: 2,
        voting: { ...doc.meta.voting },
        ...(doc.meta.strategy ? { strategy: await openStrategy(doc.meta.strategy, key) } : {}),
        ...(doc.meta.strategyChanges
          ? { strategyChanges: doc.meta.strategyChanges.map((c) => ({ ...c })) }
          : {}),
      },
      options,
      grades: effective.grades,
      comments,
      rankings: effective.rankings,
      outcomes: [...doc.outcomes],
      contributions: [...doc.contributions],
      properties: effective.properties,
      history: effective.history,
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
    const sentCount = await this.mutate(ref.id, async (db, doc) => {
      const role = this.resolveRole(doc, this.currentUser);
      if (role === "view") {
        throw new Error("PERMISSION_DENIED: View role cannot append");
      }
      // Validates the whole call before anything is written.
      const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
      checkPropertyEntries(entries, {
        optionIds: new Set(doc.options.map((o) => o.id)),
        isOwner: role === "owner",
      });
      // Resets: the owner may append any; others only their own (or the delegate's) values.
      checkResetEntries(
        entries,
        delegated
          ? { isOwner: false, self: delegated.by }
          : { isOwner: role === "owner", self: this.currentUser }
      );
      const by = delegated?.by ?? this.currentUser;
      const byName = delegated?.byName !== undefined ? { byName: delegated.byName } : {};

      let key: CryptoKey | undefined;
      if (doc.meta.protected) {
        key = this.keys.get(doc.id);
        if (!key) throw new Error("Password required");
      }

      let now = "";
      let sent = 0;

      // Every entry is appended, never replaced, and stamped with a strictly increasing time so
      // a reset clears exactly the entries appended before it (contract `history-resets`).
      for (const e of entries) {
        now = monotonicNow();
        if (e.kind === "grade") {
          doc.grades.push({
            id: newId("grd"),
            optionId: e.optionId,
            value: e.value,
            by,
            ...byName,
            at: now,
          });
          sent++;
        } else if (e.kind === "comment") {
          doc.comments.push({
            id: newId("cmt"),
            optionId: e.optionId,
            body: key ? await encryptCommentBody(e.body, key) : e.body,
            by,
            ...byName,
            at: now,
            hidden: e.hidden ?? false,
            replaces: e.replaces,
          });
          sent++;
        } else if (e.kind === "ranking") {
          doc.rankings.push({
            id: newId("rnk"),
            ranking: [...e.ranking],
            by,
            ...byName,
            round: e.round ?? doc.meta.voting.round,
            at: now,
          });
          sent++;
        } else if (e.kind === "outcome") {
          doc.outcomes.push(e.outcome);
          sent++;
        } else if (e.kind === "contribution") {
          doc.contributions.push(e.contribution);
          sent++;
        } else if (e.kind === "property") {
          const record = propertyRecord(
            { ...e, value: await sealPropertyValue(e.value, key) },
            { id: newId("prp"), at: now, by, ...byName }
          );
          doc.properties = [...(doc.properties ?? []), record];
          sent++;
        } else if (e.kind === "reset") {
          // Reset records hold no secrets beyond plugin/key, so they are stored plainly.
          doc.resets = [
            ...(doc.resets ?? []),
            resetRecord(e, { id: newId("rst"), at: now, by, ...byName }),
          ];
          sent++;
        }
      }

      doc.meta.updatedAt = now || new Date().toISOString();
      await db.put("projects", doc);
      await this.syncToHandleIfAvailable(doc);
      return sent;
    });

    await this.notifyListeners(ref);
    return { queued: 0, sent: sentCount };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    await this.mutate(ref.id, (db, doc) => this.applyOptionOps(db, doc, ops));
    await this.notifyListeners(ref);
  }

  private async applyOptionOps(
    db: IDBPDatabase,
    doc: StoredFileProject,
    ops: OptionOp[]
  ): Promise<void> {
    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update options");

    // Protected projects keep option text encrypted, so edits need the session key.
    const key = doc.meta.protected ? this.requireKey(doc.id) : undefined;
    const seal = async <T extends Partial<Option>>(o: T): Promise<T> => {
      if (!key) return o;
      const sealed = { ...o };
      if (typeof o.title === "string") sealed.title = await encrypt(o.title, key);
      if (typeof o.description === "string") {
        sealed.description = await encrypt(o.description, key);
      }
      return sealed;
    };

    const now = new Date().toISOString();

    for (const op of ops) {
      if (op.op === "add") {
        doc.options.push({
          ...(await seal(op.option)),
          by: this.currentUser,
          at: now,
        });
      } else if (op.op === "update") {
        const idx = doc.options.findIndex((o) => o.id === op.option.id);
        const current = doc.options[idx];
        if (idx >= 0 && current) {
          doc.options[idx] = { ...current, ...(await seal(op.option)) };
        }
      } else if (op.op === "remove") {
        const current = doc.options.find((o) => o.id === op.id);
        if (current) {
          current.status = "removed";
        }
      }
    }

    doc.meta.updatedAt = now;
    await db.put("projects", doc);
    await this.syncToHandleIfAvailable(doc);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    await this.mutate(ref.id, async (db, doc) => {
      const role = this.resolveRole(doc, this.currentUser);
      if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update meta");

      const key = doc.meta.protected ? this.requireKey(doc.id) : undefined;
      if (patch.title !== undefined) {
        doc.meta.title = key ? await encrypt(patch.title, key) : patch.title;
      }
      if (patch.description !== undefined) {
        doc.meta.description = key ? await encrypt(patch.description, key) : patch.description;
      }
      if (patch.voting) doc.meta.voting = { ...doc.meta.voting, ...patch.voting };
      if (patch.strategy !== undefined) {
        const current: Pick<Project, "strategy" | "strategyChanges"> = {
          strategyChanges: doc.meta.strategyChanges,
        };
        const next = applyStrategyPatch(current, patch.strategy, this.currentUser, monotonicNow());
        if (next.strategy) doc.meta.strategy = await sealStrategy(next.strategy, key);
        doc.meta.strategyChanges = next.strategyChanges;
      }

      doc.meta.updatedAt = new Date().toISOString();
      await db.put("projects", doc);
      await this.syncToHandleIfAvailable(doc);
    });
    await this.notifyListeners(ref);
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    await this.mutate(ref.id, async (db, doc) => {
      if (this.resolveRole(doc, this.currentUser) !== "owner") {
        throw new Error("PERMISSION_DENIED: Only owner can manage sharing");
      }

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
    });
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
    await this.mutate(ref.id, async (db, doc) => {
      const role = this.resolveRole(doc, this.currentUser);
      if (role !== "owner") {
        throw new Error("PERMISSION_DENIED: Only owner can delete project");
      }

      doc.trashed = true;
      await db.put("projects", doc);
    });
    this.keys.delete(ref.id);
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    await this.withLock(ref.id, async () => {
      const db = await this.dbPromise;
      await db.delete("projects", ref.id);
    });
    this.handles.delete(ref.id);
    this.keys.delete(ref.id);
  }

  /**
   * Returns the key for a protected project: derived from `password` (and remembered for the
   * session) when given, otherwise the key remembered from an earlier unlock.
   */
  private async unlock(doc: StoredFileProject, password?: string): Promise<CryptoKey> {
    if (!doc.meta.salt || !doc.meta.iterations || !doc.meta.verifier) {
      throw new Error("Invalid encryption parameters");
    }
    if (!password) {
      const cached = this.keys.get(doc.id);
      if (cached && (await checkVerifier(doc.meta.verifier, cached))) return cached;
      this.keys.delete(doc.id);
      throw new Error("Password required");
    }
    const key = await deriveKey(password, base64ToBytes(doc.meta.salt), doc.meta.iterations);
    if (!(await checkVerifier(doc.meta.verifier, key))) {
      throw new Error("Incorrect password");
    }
    this.keys.set(doc.id, key);
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

  /** Serialized read-modify-write of one live (not trashed) project document. */
  private mutate<T>(
    projectId: string,
    fn: (db: IDBPDatabase, doc: StoredFileProject) => Promise<T>
  ): Promise<T> {
    return this.withLock(projectId, async () => {
      const db = await this.dbPromise;
      const doc: StoredFileProject | undefined = await db.get("projects", projectId);
      if (!doc || doc.trashed) throw new Error("Project unavailable or not found");
      return fn(db, doc);
    });
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
            ...(doc.meta.strategy ? { strategy: doc.meta.strategy } : {}),
            ...(doc.meta.strategyChanges ? { strategyChanges: doc.meta.strategyChanges } : {}),
          },
          options: doc.options,
          grades: doc.grades,
          comments: doc.comments,
          rankings: doc.rankings,
          outcomes: doc.outcomes,
          contributions: doc.contributions,
          properties: doc.properties ?? [],
          resets: doc.resets ?? [],
        };
        await writable.write(JSON.stringify(exportData, null, 2));
        await writable.close();
      } catch {
        // Fallback: handle write failure silently
      }
    }
  }
}
