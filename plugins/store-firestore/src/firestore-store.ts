import {
  type Comment,
  type Contribution,
  type Grade,
  type Option,
  type OutcomeRecord,
  type Project,
  type PropertyScalar,
  type PropertyValue,
  type Ranking,
  type Reset,
  type SealContext,
  effectiveEntries,
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
  readStoredByName,
  resetRecord,
  resolveDelegatedAuthor,
} from "@decisionator/plugin-sdk";
import type { FirestoreEntryDoc, FirestoreOptionDoc, FirestoreProjectDoc } from "./collections.js";
import {
  checkVerifier,
  decrypt,
  encrypt,
  isSealed,
  setupPasswordProtection,
  verifyAndDerivePasswordKey,
} from "./crypto.js";
import { openOption, sealOption } from "./option-seal.js";

/** Seal contexts (codec v2 additional data): where each sealed value lives. */
const TITLE_CONTEXT: SealContext = ["meta", "title"];
const DESCRIPTION_CONTEXT: SealContext = ["meta", "description"];
const commentContext = (id: string): SealContext => ["comment", id, "body"];
const propertyContext = (id: string): SealContext => ["property", id, "value"];

/**
 * Text fields of protected projects are stored encrypted. An empty value (e.g. the body of a
 * hide/unhide toggle comment) is stored as-is, and values written in plaintext by older versions
 * are read back unchanged instead of making the whole project unreadable. Ciphertext that does
 * not decrypt is an error, never returned as text.
 */
async function openSealed(value: string, key: CryptoKey, context: SealContext): Promise<string> {
  if (!isSealed(value)) return value;
  return decrypt(value, key, context);
}

async function encryptCommentBody(body: string, key: CryptoKey, id: string): Promise<string> {
  return body === "" ? "" : encrypt(body, key, commentContext(id));
}

/** Property values of protected projects are stored as their JSON, encrypted. */
async function sealPropertyValue(
  value: PropertyScalar,
  key: CryptoKey,
  id: string
): Promise<string> {
  return encrypt(JSON.stringify(value), key, propertyContext(id));
}

async function openPropertyValue(
  value: PropertyScalar,
  key: CryptoKey,
  id: string
): Promise<PropertyScalar> {
  if (!isSealed(value)) return value;
  return JSON.parse(await decrypt(value, key, propertyContext(id))) as PropertyScalar;
}

type StoredStrategy = Pick<Project, "strategy" | "strategyChanges">;

/** Strategy meta of protected projects is stored as its JSON, encrypted, like the title. */
async function sealJson<T>(value: T | undefined, key: CryptoKey | undefined, field: string) {
  if (value === undefined || !key) return value;
  return encrypt(JSON.stringify(value), key, ["meta", field]);
}

async function openJson<T>(
  value: T | string | undefined,
  key: CryptoKey | undefined,
  field: string
) {
  if (typeof value !== "string") return value;
  if (!key || !isSealed(value)) return undefined;
  return JSON.parse(await decrypt(value, key, ["meta", field])) as T;
}

async function readStrategy(
  doc: FirestoreProjectDoc,
  key: CryptoKey | undefined
): Promise<StoredStrategy> {
  const strategy = await openJson(doc.strategy, key, "strategy");
  const strategyChanges = await openJson(doc.strategyChanges, key, "strategyChanges");
  return {
    ...(strategy ? { strategy } : {}),
    ...(strategyChanges ? { strategyChanges } : {}),
  };
}

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

/**
 * EXPERIMENTAL, IN-MEMORY MOCK of a Firestore-backed store. Nothing is sent over the network and
 * nothing persists beyond this object; there is no server-side security, so every role and
 * authorship check below is client-side only. A real Firestore backend must ship `firestore.rules`
 * enforcing authorship (`by` = the signed-in user), roles, owner-only meta/options/outcomes and
 * append-only entries — see this package's README.
 */
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

    let key: CryptoKey | undefined;
    if (opts?.password !== undefined) {
      const p = await setupPasswordProtection(opts.password);
      salt = p.salt;
      verifier = p.verifier;
      iterations = p.iterations;
      key = p.key;

      initialTitle = await encrypt(initialTitle, p.key, TITLE_CONTEXT);
      initialDesc = await encrypt(initialDesc, p.key, DESCRIPTION_CONTEXT);
    }

    for (const [idx, o] of inputOpts.entries()) {
      const optionDoc: FirestoreOptionDoc = {
        ...o,
        description: o.description || "",
        order: o.order ?? idx + 1,
        status: o.status ?? "active",
        tags: o.tags ?? [],
        pros: o.pros ?? [],
        cons: o.cons ?? [],
        links: o.links ?? [],
        at: o.at ?? now,
        by: this.currentUser,
      };
      // Every user-content field of an option is sealed in a protected project.
      projectOptions.set(o.id, key ? await sealOption(optionDoc, key) : optionDoc);
    }

    const doc: FirestoreProjectDoc = {
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
      const decryptedTitle = await openSealed(doc.title, key, TITLE_CONTEXT);
      const decryptedDesc = await openSealed(doc.description, key, DESCRIPTION_CONTEXT);

      const decryptedOptions: Option[] = [];
      for (const opt of optsMap.values()) {
        decryptedOptions.push(await openOption(opt, key));
      }

      const { grades, comments, rankings, outcomes, contributions, properties, history } =
        this.buildEntries(entryList);

      const decryptedComments = await Promise.all(
        comments.map(async (c) => ({
          ...c,
          body: await openSealed(c.body, key, commentContext(c.id)),
        }))
      );
      const openValues = (list: PropertyValue[]) =>
        Promise.all(
          list.map(async (p) => ({ ...p, value: await openPropertyValue(p.value, key, p.id) }))
        );
      const decryptedProperties = await openValues(properties);
      const decryptedHistory = { ...history, properties: await openValues(history.properties) };

      return {
        project: {
          title: decryptedTitle,
          description: decryptedDesc,
          protected: true,
          formatVersion: 2,
          voting: { ...doc.voting },
          ...(await readStrategy(doc, key)),
        },
        options: decryptedOptions,
        grades,
        comments: decryptedComments,
        rankings,
        outcomes,
        contributions,
        properties: decryptedProperties,
        history: decryptedHistory,
        role,
      };
    }

    const { grades, comments, rankings, outcomes, contributions, properties, history } =
      this.buildEntries(entryList);

    return {
      project: {
        title: doc.title,
        description: doc.description,
        protected: false,
        formatVersion: 2,
        voting: { ...doc.voting },
        ...(await readStrategy(doc, undefined)),
      },
      options: Array.from(optsMap.values()),
      grades,
      comments,
      rankings,
      outcomes,
      contributions,
      properties,
      history,
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
    if (role !== "owner" && entries.some((e) => e.kind === "outcome")) {
      throw new Error("PERMISSION_DENIED: Only the project owner may record an outcome");
    }
    // Validates the whole call before anything is written.
    const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
    const by = delegated?.by ?? this.currentUser;
    const byName = delegated?.byName !== undefined ? { byName: delegated.byName } : {};
    checkPropertyEntries(entries, {
      optionIds: new Set((this.options.get(ref.id) ?? new Map()).keys()),
      isOwner: role === "owner",
    });
    checkResetEntries(entries, { isOwner: role === "owner" && !delegated, self: by });

    // Protected projects keep comment bodies encrypted, so writes need the session key.
    // Bodies are sealed before anything is written, so a failure leaves no partial append.
    const key = this.writeKey(ref.id, doc);
    // Ids are chosen up front: sealed values are bound to the id of their entry.
    const entryIds = entries.map(
      () => `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );
    const bodies = await Promise.all(
      entries.map((e, i) =>
        e.kind === "comment" && key ? encryptCommentBody(e.body, key, entryIds[i] ?? "") : null
      )
    );
    const sealedValues = await Promise.all(
      entries.map((e, i) =>
        e.kind === "property" && key ? sealPropertyValue(e.value, key, entryIds[i] ?? "") : null
      )
    );

    const entryList = this.entries.get(ref.id) || [];
    let sentCount = 0;
    let now = doc.updatedAt;

    for (const [i, e] of entries.entries()) {
      // Strictly increasing stamps keep "appended after a reset" decidable by time.
      now = monotonicNow();
      const entryId =
        entryIds[i] ?? `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
        // Stamped like every entry (rule 1); contributions are never delegated.
        entryList.push({
          id: entryId,
          kind: "contribution",
          contribution: { ...e.contribution, id: e.contribution.id || entryId, by, at: now },
          by,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "property") {
        entryList.push({
          id: entryId,
          kind: "property",
          optionId: e.optionId,
          plugin: e.plugin,
          key: e.key,
          scope: e.scope,
          value: sealedValues[i] ?? e.value,
          by,
          ...byName,
          at: now,
        });
        sentCount++;
      } else if (e.kind === "reset") {
        entryList.push({
          ...resetRecord(e, { id: entryId, at: now, by, ...byName }),
          kind: "reset",
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
    const key = this.writeKey(ref.id, doc);
    const seal = <T extends Partial<Option>>(o: T): Promise<T> =>
      key ? sealOption(o, key) : Promise.resolve(o);
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

    const key = this.writeKey(ref.id, doc);
    const seal = (value: string | undefined, context: SealContext) =>
      value !== undefined && key ? encrypt(value, key, context) : value;
    const title = await seal(patch.title, TITLE_CONTEXT);
    const description = await seal(patch.description, DESCRIPTION_CONTEXT);
    const now = monotonicNow();
    let strategyMeta: Pick<FirestoreProjectDoc, "strategy" | "strategyChanges"> | undefined;
    if (patch.strategy) {
      const next = applyStrategyPatch(
        await readStrategy(doc, key),
        patch.strategy,
        this.currentUser,
        now
      );
      strategyMeta = {
        strategy: await sealJson(next.strategy, key, "strategy"),
        strategyChanges: await sealJson(next.strategyChanges, key, "strategyChanges"),
      };
    }

    if (title !== undefined) doc.title = title;
    if (description !== undefined) doc.description = description;
    if (patch.voting) doc.voting = { ...doc.voting, ...patch.voting };
    if (strategyMeta) Object.assign(doc, strategyMeta);

    doc.updatedAt = now;
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

  /**
   * The key writes to the project must be sealed with, or `undefined` for a plain project. A
   * project unlocked in this session is never written in plaintext, even if its document now says
   * it is not protected (that would be an encryption downgrade).
   */
  private writeKey(projectId: string, doc: FirestoreProjectDoc): CryptoKey | undefined {
    const key = this.keys.get(projectId);
    if (!doc.protected) {
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

  private resolveRole(doc: FirestoreProjectDoc, user: string): ParticipantRole {
    if (doc.owner === user) return "owner";
    const found = doc.collaborators.find((c) => c.email === user);
    return found ? found.role : "view";
  }

  private buildEntries(entryList: FirestoreEntryDoc[]) {
    const grades: Grade[] = [];
    const comments: Comment[] = [];
    const rankings: Ranking[] = [];
    const outcomes: OutcomeRecord[] = [];
    const contributions: Contribution[] = [];
    const properties: PropertyValue[] = [];
    const resets: Reset[] = [];
    const nameOf = (value: unknown) => {
      const byName = readStoredByName(value);
      return byName === undefined ? {} : { byName };
    };

    // Entries are kept in append order; latest-wins and resets are applied by effectiveEntries.
    for (const e of entryList) {
      if (e.kind === "grade") {
        grades.push({
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
        rankings.push({
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
        // The author and time are the entry's stamp, never what the caller put in the payload.
        contributions.push({ ...e.contribution, by: e.by, at: e.at });
      } else if (e.kind === "property") {
        properties.push({
          id: e.id,
          at: e.at,
          by: e.by,
          ...nameOf(e.byName),
          optionId: e.optionId,
          plugin: e.plugin,
          key: e.key,
          scope: e.scope,
          value: e.value,
        });
      } else if (e.kind === "reset") {
        const { kind: _kind, byName, ...rest } = e;
        resets.push({ ...rest, ...nameOf(byName) } as Reset);
      }
    }

    const effective = effectiveEntries({ grades, rankings, properties, resets });
    return {
      grades: effective.grades,
      comments,
      rankings: effective.rankings,
      outcomes,
      contributions,
      properties: effective.properties,
      history: effective.history,
    };
  }
}
