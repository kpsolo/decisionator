import {
  type Comment,
  type Contribution,
  type Grade,
  KDF_DEFAULT_ITERATIONS,
  type Option,
  type OutcomeRecord,
  type Project,
  type PropertyValue,
  type Ranking,
  type Reset,
  type SealContext,
  assertPasswordStrength,
  checkKdfIterations,
  checkVerifier,
  decrypt,
  deriveKey,
  effectiveEntries,
  encrypt,
  generateSalt,
  isSealed,
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
import { announceChange, instanceId, listenForChanges, withProjectLock } from "./cross-tab.js";
import { openOption, sealOption } from "./option-seal.js";

/** Seal contexts (codec v2 additional data): where each sealed value lives. */
const TITLE_CONTEXT: SealContext = ["meta", "title"];
const DESCRIPTION_CONTEXT: SealContext = ["meta", "description"];
const STRATEGY_CONTEXT: SealContext = ["meta", "strategy", "settings"];
const commentContext = (id: string): SealContext => ["comment", id, "body"];
const propertyContext = (id: string): SealContext => ["property", id, "value"];

/**
 * Text fields of protected projects are stored encrypted. An empty value (e.g. the body of a
 * hide/unhide toggle comment) is stored as-is, and values written in plaintext by older versions
 * are read back unchanged instead of making the whole project unreadable.
 */
async function openSealed(value: string, key: CryptoKey, context: SealContext): Promise<string> {
  if (!isSealed(value)) return value;
  return decrypt(value, key, context);
}

async function encryptCommentBody(body: string, key: CryptoKey, id: string): Promise<string> {
  return body === "" ? "" : encrypt(body, key, commentContext(id));
}

/** Property values of protected projects are stored as an encrypted JSON string. */
async function sealPropertyValue(
  value: PropertyValue["value"],
  key: CryptoKey | undefined,
  id: string
): Promise<PropertyValue["value"]> {
  return key ? encrypt(JSON.stringify(value), key, propertyContext(id)) : value;
}

async function openPropertyValue(
  value: PropertyValue["value"],
  key: CryptoKey,
  id: string
): Promise<PropertyValue["value"]> {
  if (!isSealed(value)) return value;
  return JSON.parse(await decrypt(value, key, propertyContext(id))) as PropertyValue["value"];
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
    ? {
        ...stamp,
        sealedSettings: await encrypt(JSON.stringify(strategy.settings), key, STRATEGY_CONTEXT),
      }
    : { ...stamp, settings: strategy.settings };
}

async function openStrategy(
  stored: StoredStrategy,
  key: CryptoKey | undefined
): Promise<ProjectStrategy> {
  let settings = stored.settings ?? {};
  if (stored.sealedSettings !== undefined) {
    if (!key) throw new Error("Password required");
    settings = JSON.parse(await decrypt(stored.sealedSettings, key, STRATEGY_CONTEXT)) as Record<
      string,
      unknown
    >;
  }
  return { id: stored.id, version: stored.version, settings, at: stored.at, by: stored.by };
}

/** A failed write of a project's linked JSON file (see `FileProjectStore.onFileSyncError`). */
export interface FileSyncError {
  projectId: string;
  /** Message starts with `FILE_WRITE_FAILED`. */
  error: Error;
}

interface WritableLike {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
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
  /** Names this instance in change announcements, so it ignores its own. */
  private readonly instance = instanceId();
  /** Stops listening for other tabs' changes, by project id; open while anyone watches. */
  private crossTabListeners = new Map<string, () => void>();
  /** The last failed write of each project's linked file, cleared by the next good write. */
  private syncErrors = new Map<string, Error>();
  private syncErrorListeners = new Set<(e: FileSyncError) => void>();

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

  /**
   * The error of the last write of the project's linked file, or `undefined` when it was written
   * (or has no linked file). A failed write keeps the change in the browser; the next change
   * rewrites the whole file.
   */
  getFileSyncError(projectId: string): Error | undefined {
    return this.syncErrors.get(projectId);
  }

  /** Calls `listener` whenever a write of a linked file fails. */
  onFileSyncError(listener: (e: FileSyncError) => void): Unsubscribe {
    this.syncErrorListeners.add(listener);
    return () => {
      this.syncErrorListeners.delete(listener);
    };
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

    if (opts?.password !== undefined) {
      assertPasswordStrength(opts.password);
      const saltBytes = generateSalt();
      salt = bytesToBase64(saltBytes);
      iterations = KDF_DEFAULT_ITERATIONS;

      const key = await deriveKey(opts.password, saltBytes, iterations);
      verifier = await makeVerifier(key);

      initialTitle = await encrypt(initialTitle, key, TITLE_CONTEXT);
      initialDesc = await encrypt(initialDesc, key, DESCRIPTION_CONTEXT);

      initialOptions = await Promise.all(initialOptions.map((opt) => sealOption(opt, key)));
    }

    const doc: StoredFileProject = {
      id,
      meta: {
        formatVersion: 2,
        title: initialTitle,
        description: initialDesc,
        protected: opts?.password !== undefined,
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
    const open = (value: string, context: SealContext) =>
      key ? openSealed(value, key, context) : Promise.resolve(value);

    const options = key
      ? await Promise.all(doc.options.map((opt) => openOption(opt, key)))
      : [...doc.options];
    const comments = await Promise.all(
      doc.comments.map(async (c) => ({ ...c, body: await open(c.body, commentContext(c.id)) }))
    );
    const properties = await Promise.all(
      (doc.properties ?? []).map(async (p) =>
        key ? { ...p, value: await openPropertyValue(p.value, key, p.id) } : { ...p }
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
        title: await open(doc.meta.title, TITLE_CONTEXT),
        description: await open(doc.meta.description, DESCRIPTION_CONTEXT),
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
    // Changes made by other tabs (or other instances on the same database) are announced.
    if (!this.crossTabListeners.has(ref.id)) {
      this.crossTabListeners.set(
        ref.id,
        listenForChanges(ref.id, this.instance, () => void this.notifyListeners(ref))
      );
    }
    return () => {
      set?.delete(onChange);
      if (set?.size === 0) {
        this.crossTabListeners.get(ref.id)?.();
        this.crossTabListeners.delete(ref.id);
      }
    };
  }

  /** Tells this instance's watchers and the other tabs that the project changed. */
  private async changed(ref: ProjectRef): Promise<void> {
    announceChange(ref.id, this.instance);
    await this.notifyListeners(ref);
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
      if (role !== "owner" && entries.some((e) => e.kind === "outcome")) {
        throw new Error("PERMISSION_DENIED: Only the project owner may record an outcome");
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

      const key = this.writeKey(doc);

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
          const id = newId("cmt");
          doc.comments.push({
            id,
            optionId: e.optionId,
            body: key ? await encryptCommentBody(e.body, key, id) : e.body,
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
          // Stamped like every entry (rule 1); contributions are never delegated.
          doc.contributions.push({
            ...e.contribution,
            id: e.contribution.id || newId("ctb"),
            by,
            at: now,
          });
          sent++;
        } else if (e.kind === "property") {
          const id = newId("prp");
          const record = propertyRecord(
            { ...e, value: await sealPropertyValue(e.value, key, id) },
            { id, at: now, by, ...byName }
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

    await this.changed(ref);
    return { queued: 0, sent: sentCount };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    await this.mutate(ref.id, (db, doc) => this.applyOptionOps(db, doc, ops));
    await this.changed(ref);
  }

  private async applyOptionOps(
    db: IDBPDatabase,
    doc: StoredFileProject,
    ops: OptionOp[]
  ): Promise<void> {
    const role = this.resolveRole(doc, this.currentUser);
    if (role !== "owner") throw new Error("PERMISSION_DENIED: Only owner can update options");

    // Protected projects keep option text encrypted, so edits need the session key.
    const key = this.writeKey(doc);
    const seal = <T extends Partial<Option>>(o: T): Promise<T> =>
      key ? sealOption(o, key) : Promise.resolve(o);

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

      const key = this.writeKey(doc);
      if (patch.title !== undefined) {
        doc.meta.title = key ? await encrypt(patch.title, key, TITLE_CONTEXT) : patch.title;
      }
      if (patch.description !== undefined) {
        doc.meta.description = key
          ? await encrypt(patch.description, key, DESCRIPTION_CONTEXT)
          : patch.description;
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
    await this.changed(ref);
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
    await withProjectLock(ref.id, async () => {
      const db = await this.dbPromise;
      await db.delete("projects", ref.id);
    });
    this.handles.delete(ref.id);
    this.syncErrors.delete(ref.id);
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
    const iterations = checkKdfIterations(doc.meta.iterations);
    const key = await deriveKey(password, base64ToBytes(doc.meta.salt), iterations);
    if (!(await checkVerifier(doc.meta.verifier, key))) {
      throw new Error("Incorrect password");
    }
    this.keys.set(doc.id, key);
    return key;
  }

  /**
   * The key writes to `doc` must be sealed with, or `undefined` for a plain project. A project
   * unlocked in this session is never written in plaintext, even if its document now says it is
   * not protected (that would be an encryption downgrade).
   */
  private writeKey(doc: StoredFileProject): CryptoKey | undefined {
    const key = this.keys.get(doc.id);
    if (!doc.meta.protected) {
      if (key) {
        throw new Error(
          "PROTECTION_DOWNGRADE: this project was unlocked with a password in this session but is no longer marked protected; refusing to write it unencrypted"
        );
      }
      return undefined;
    }
    if (!key) throw new Error("Password required");
    return key;
  }

  /**
   * Read-modify-write of one live (not trashed) project document under the project's lock, which
   * every instance and tab on the same database honours, so concurrent writers never overwrite
   * each other's changes. The document is read inside the lock.
   */
  private mutate<T>(
    projectId: string,
    fn: (db: IDBPDatabase, doc: StoredFileProject) => Promise<T>
  ): Promise<T> {
    return withProjectLock(projectId, async () => {
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

  /**
   * Writes the project to its linked JSON file, if it has one. A protected project is written as
   * stored (encrypted) together with its key derivation parameters (`project.kdf`), so the file
   * can be unlocked with the password when it is opened again. A failed write does not undo the
   * change, which is kept in the browser; it is reported through `getFileSyncError` and
   * `onFileSyncError`.
   */
  private async syncToHandleIfAvailable(doc: StoredFileProject): Promise<void> {
    const handle = this.handles.get(doc.id);
    if (!handle) return;
    let writable: WritableLike | undefined;
    try {
      if (!("createWritable" in handle)) {
        throw new Error("this browser cannot write to files");
      }
      writable = await (
        handle as unknown as { createWritable: () => Promise<WritableLike> }
      ).createWritable();
      const { salt, iterations, verifier } = doc.meta;
      const exportData = {
        format: "decisionator.project/v1",
        exportedAt: new Date().toISOString(),
        project: {
          title: doc.meta.title,
          description: doc.meta.description,
          protected: doc.meta.protected,
          ...(doc.meta.protected && salt && iterations
            ? {
                kdf: {
                  alg: "pbkdf2-sha256",
                  iterations,
                  salt,
                  ...(verifier ? { verifier } : {}),
                },
              }
            : {}),
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
      this.syncErrors.delete(doc.id);
    } catch (err) {
      await writable?.abort?.().catch(() => undefined);
      this.reportSyncError(doc.id, handle, err);
    }
  }

  private reportSyncError(projectId: string, handle: FileSystemFileHandle, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    const name = typeof handle.name === "string" && handle.name ? `"${handle.name}"` : "file";
    const error = new Error(
      `FILE_WRITE_FAILED: The linked ${name} could not be written: ${reason}. The change is saved in this browser only.`,
      { cause: err }
    );
    this.syncErrors.set(projectId, error);
    for (const listener of this.syncErrorListeners) {
      try {
        listener({ projectId, error });
      } catch {
        // A failing listener must not hide the error from the others.
      }
    }
  }
}
