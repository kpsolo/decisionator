import * as A from "@automerge/automerge";
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
async function openPropertyValue(
  value: PropertyValue["value"],
  key: CryptoKey,
  id: string
): Promise<PropertyValue["value"]> {
  if (!isSealed(value)) return value;
  return JSON.parse(await decrypt(value, key, propertyContext(id))) as PropertyValue["value"];
}

/**
 * The chosen strategy as stored. `settings` is a JSON string, encrypted in a protected project
 * like the title; a string also keeps arbitrary settings clear of Automerge's value rules.
 */
interface StoredStrategy {
  id: string;
  version: string;
  at: string;
  by: string;
  settings: string;
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
  /** Names this instance in change announcements, so it ignores its own. */
  private readonly instance = instanceId();
  /** Stops listening for other tabs' changes, by project id; open while anyone watches. */
  private crossTabListeners = new Map<string, () => void>();

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

    if (opts?.password !== undefined) {
      assertPasswordStrength(opts.password);
      const salt = generateSalt();
      const iter = KDF_DEFAULT_ITERATIONS;
      const cryptoKey = await deriveKey(opts.password, salt, iter);
      saltB64 = bytesToBase64(salt);
      verifier = await makeVerifier(cryptoKey);
      iterations = iter;

      initialTitle = await encrypt(input.title, cryptoKey, TITLE_CONTEXT);
      initialDesc = input.description
        ? await encrypt(input.description, cryptoKey, DESCRIPTION_CONTEXT)
        : "";
      initialOptions = await Promise.all(initialOptions.map((opt) => sealOption(opt, cryptoKey)));
    }

    const initialDoc: AutomergeProjectDoc = {
      meta: {
        formatVersion: 1,
        title: initialTitle,
        description: initialDesc,
        protected: opts?.password !== undefined,
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
      properties: [],
      resets: [],
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
    let finalProperties: PropertyValue[] = doc.properties ?? [];
    let strategySettings = doc.meta.strategy?.settings;

    if (doc.meta.protected) {
      const cryptoKey = await this.unlock(ref.id, doc, opts?.password);
      if (strategySettings !== undefined) {
        strategySettings = await openSealed(strategySettings, cryptoKey, STRATEGY_CONTEXT);
      }
      finalTitle = await openSealed(finalTitle, cryptoKey, TITLE_CONTEXT);
      finalDesc = await openSealed(finalDesc, cryptoKey, DESCRIPTION_CONTEXT);
      finalOptions = await Promise.all(doc.options.map((o) => openOption(o, cryptoKey)));
      finalComments = await Promise.all(
        doc.comments.map(async (c) => ({
          ...c,
          body: await openSealed(c.body, cryptoKey, commentContext(c.id)),
        }))
      );
      finalProperties = await Promise.all(
        finalProperties.map(async (p) => ({
          ...p,
          value: await openPropertyValue(p.value, cryptoKey, p.id),
        }))
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

    // Latest wins and resets, with the superseded and cleared entries as history.
    const effective = effectiveEntries({
      grades: doc.grades,
      rankings: doc.rankings,
      properties: finalProperties,
      resets: doc.resets ?? [],
    });
    const strategy = doc.meta.strategy;

    return {
      project: {
        title: finalTitle,
        description: finalDesc,
        protected: doc.meta.protected,
        voting: doc.meta.voting,
        formatVersion: 1,
        ...(strategy && strategySettings !== undefined
          ? {
              strategy: {
                id: strategy.id,
                version: strategy.version,
                settings: JSON.parse(strategySettings) as Record<string, unknown>,
                at: strategy.at,
                by: strategy.by,
              },
            }
          : {}),
        ...(doc.meta.strategyChanges
          ? {
              strategyChanges: doc.meta.strategyChanges.map((c) => ({
                id: c.id,
                at: c.at,
                by: c.by,
              })),
            }
          : {}),
      },
      options: finalOptions,
      grades: effective.grades,
      comments: finalComments,
      rankings: effective.rankings,
      outcomes: doc.outcomes,
      contributions: doc.contributions,
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
        listenForChanges(ref.id, this.instance, () => void this.notify(ref))
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
    await this.notify(ref);
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
      // Automerge rejects `undefined` values, so the key is omitted when there is no name.
      const byName = delegated?.byName !== undefined ? { byName: delegated.byName } : {};

      const newId = (prefix: string) =>
        `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      // Ids are chosen up front: sealed values are bound to the id of their record.
      const ids = entries.map((e) =>
        e.kind === "comment" ? newId("c") : e.kind === "property" ? newId("p") : ""
      );

      // Protected projects keep comment bodies encrypted, so writes need the session key.
      // `A.change` is synchronous, so bodies are sealed up front.
      const key = this.writeKey(ref.id, doc);
      const bodies = await Promise.all(
        entries.map((e, i) =>
          e.kind === "comment" && key ? encryptCommentBody(e.body, key, ids[i] ?? "") : null
        )
      );
      // Property values are sealed as JSON strings, also up front.
      const values = await Promise.all(
        entries.map((e, i) =>
          e.kind === "property" && key
            ? encrypt(JSON.stringify(e.value), key, propertyContext(ids[i] ?? ""))
            : null
        )
      );

      // Every entry is appended, never replaced, and stamped with a strictly increasing time so
      // a reset clears exactly the entries appended before it (contract `history-resets`).
      const stamps = entries.map(() => monotonicNow());

      return A.change(doc, (d) => {
        for (const [i, entry] of entries.entries()) {
          const at = stamps[i] ?? monotonicNow();
          if (entry.kind === "grade") {
            const newGrade: Grade = {
              id: newId("g"),
              optionId: entry.optionId,
              value: entry.value,
              by,
              ...byName,
              at,
            };
            d.grades.push(newGrade);
          } else if (entry.kind === "comment") {
            const newComment: Comment = {
              id: ids[i] || newId("c"),
              optionId: entry.optionId,
              body: bodies[i] ?? entry.body,
              by,
              ...byName,
              at,
              ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
              ...(entry.replaces !== undefined ? { replaces: entry.replaces } : {}),
            };
            d.comments.push(newComment);
          } else if (entry.kind === "ranking") {
            const newRanking: Ranking = {
              id: newId("r"),
              ranking: [...entry.ranking],
              round: entry.round ?? d.meta.voting.round,
              by,
              ...byName,
              at,
            };
            d.rankings.push(newRanking);
          } else if (entry.kind === "outcome") {
            d.outcomes.push(entry.outcome);
          } else if (entry.kind === "contribution") {
            // Stamped like every entry (rule 1); contributions are never delegated. The JSON copy
            // drops `undefined` values, which Automerge rejects.
            const contribution = JSON.parse(JSON.stringify(entry.contribution)) as Contribution;
            d.contributions.push({
              ...contribution,
              id: contribution.id || newId("ctb"),
              by,
              at,
            });
          } else if (entry.kind === "property") {
            // `propertyRecord` omits `byName` when absent, and a cleared value is stored as
            // `null`, never `undefined`.
            const record = propertyRecord(
              { ...entry, value: values[i] ?? entry.value },
              { id: ids[i] || newId("p"), at, by, ...byName }
            );
            if (!d.properties) d.properties = [];
            d.properties.push(record);
          } else if (entry.kind === "reset") {
            // `resetRecord` omits absent optional fields. Reset records hold no secrets beyond
            // plugin/key, so they are stored plainly.
            if (!d.resets) d.resets = [];
            d.resets.push(resetRecord(entry, { id: newId("x"), at, by, ...byName }));
          }
        }
      });
    });

    await this.changed(ref);
    return { queued: 0, sent: entries.length };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    await this.mutate(ref.id, async (doc) => {
      if (doc.meta.owner !== this.currentUser) {
        throw new Error("PERMISSION_DENIED: Only owner can update options");
      }

      // Protected projects keep option text encrypted, so edits need the session key.
      // `A.change` is synchronous, so options are sealed up front.
      const key = this.writeKey(ref.id, doc);
      const seal = <T extends Partial<Option>>(o: T): Promise<T> =>
        key ? sealOption(o, key) : Promise.resolve(o);
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
    await this.changed(ref);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    await this.mutate(ref.id, async (doc) => {
      if (doc.meta.owner !== this.currentUser) {
        throw new Error("PERMISSION_DENIED: Only owner can update metadata");
      }

      const key = this.writeKey(ref.id, doc);
      const seal = (value: string | undefined, context: SealContext) =>
        value !== undefined && key ? encrypt(value, key, context) : value;
      const title = await seal(patch.title, TITLE_CONTEXT);
      const description = await seal(patch.description, DESCRIPTION_CONTEXT);
      // Strategy choice: stamped here, settings kept as (sealed) JSON.
      const current: Pick<Project, "strategy" | "strategyChanges"> = {
        ...(doc.meta.strategyChanges
          ? {
              strategyChanges: doc.meta.strategyChanges.map((c) => ({
                id: c.id,
                at: c.at,
                by: c.by,
              })),
            }
          : {}),
      };
      const next = patch.strategy
        ? applyStrategyPatch(current, patch.strategy, this.currentUser, monotonicNow())
        : undefined;
      const strategySettings = next?.strategy
        ? await seal(JSON.stringify(next.strategy.settings), STRATEGY_CONTEXT)
        : undefined;

      return A.change(doc, (d) => {
        if (title !== undefined) d.meta.title = title;
        if (description !== undefined) d.meta.description = description;
        if (patch.voting) {
          d.meta.voting = { ...d.meta.voting, ...patch.voting };
        }
        if (next?.strategy && strategySettings !== undefined) {
          d.meta.strategy = {
            id: next.strategy.id,
            version: next.strategy.version,
            at: next.strategy.at ?? "",
            by: next.strategy.by ?? "",
            settings: strategySettings,
          };
          d.meta.strategyChanges = next.strategyChanges ?? [];
        }
      });
    });
    await this.changed(ref);
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
    await withProjectLock(ref.id, async () => {
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
    await withProjectLock(ref.id, async () => {
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
    // Older docs may lack the count; they were written with the default.
    const iterations = checkKdfIterations(doc.meta.iterations ?? KDF_DEFAULT_ITERATIONS);
    const key = await deriveKey(password, salt, iterations);
    if (!(await checkVerifier(doc.meta.verifier, key))) {
      throw new Error("Incorrect password");
    }
    this.keys.set(projectId, key);
    return key;
  }

  /**
   * The key writes to the project must be sealed with, or `undefined` for a plain project. A
   * project unlocked in this session is never written in plaintext, even if its document now says
   * it is not protected (that would be an encryption downgrade).
   */
  private writeKey(projectId: string, doc: A.Doc<AutomergeProjectDoc>): CryptoKey | undefined {
    const key = this.keys.get(projectId);
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
   * Load-change-save cycle of one live project document under the project's lock, which every
   * instance and tab on the same database honours, so concurrent writers never overwrite each
   * other's changes. The document is loaded inside the lock.
   */
  private mutate(
    projectId: string,
    fn: (doc: A.Doc<AutomergeProjectDoc>) => Promise<A.Doc<AutomergeProjectDoc>>
  ): Promise<void> {
    return withProjectLock(projectId, async () => {
      const doc = await fn(await this.loadDoc(projectId));
      await this.saveDoc(projectId, doc);
    });
  }
}
