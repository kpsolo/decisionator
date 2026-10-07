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
  propertyRecord,
  resetRecord,
  resolveDelegatedAuthor,
} from "@decisionator/plugin-sdk";

/** A stored entry: what the caller sent, plus the author stamp and time the store added. */
type StoredEntry = Entry & { id: string; by: string; byName?: string; at: string };

interface StoredProject {
  project: Project;
  options: Option[];
  entries: StoredEntry[];
  owner: string;
  collaborators: Map<string, "contribute" | "view">;
  /** Example only: a real store derives a key and encrypts instead of keeping the password. */
  password?: string;
  trashed: boolean;
}

/**
 * The data every signed-in user of the example store sees. Share one backend between several
 * `MemoryProjectStore` instances to simulate collaborators on the same remote store.
 */
export class MemoryBackend {
  readonly projects = new Map<string, StoredProject>();
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

/**
 * Example ProjectStore (contract v1.4.0) that keeps everything in memory. It shows the rules a
 * store must follow: author stamping, roles, append-only history with resets, delegated append
 * and soft delete.
 */
export class MemoryProjectStore implements ProjectStore {
  readonly id = "org.decisionator.examples.store.memory";
  private listeners = new Map<string, Set<(s: ProjectSnapshot) => void>>();
  /** Projects unlocked with their password in this session. */
  private unlocked = new Set<string>();

  constructor(
    private defaultUser = "alice@example.com",
    private backend = new MemoryBackend()
  ) {}

  async signIn(): Promise<Identity> {
    return {
      participantId: this.defaultUser,
      displayName: this.defaultUser.split("@")[0] || this.defaultUser,
      email: this.defaultUser,
    };
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const list: ProjectSummary[] = [];
    for (const [id, data] of this.backend.projects.entries()) {
      if (!data.trashed && this.roleOf(data) !== undefined) {
        list.push({
          ref: { store: "memory", id },
          title: data.password ? "Protected project" : data.project.title,
          owner: data.owner,
          isProtected: Boolean(data.password),
        });
      }
    }
    return list;
  }

  async createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef> {
    const id = newId("mem");
    const project: Project = {
      title: input.title,
      description: input.description || "",
      protected: Boolean(opts?.password),
      voting: input.voting ?? { state: "open", round: 1, topN: 3, liveResults: true },
      formatVersion: 1,
    };

    this.backend.projects.set(id, {
      project,
      options: (input.options || []).map((o, idx) => ({ ...o, order: o.order ?? idx + 1 })),
      entries: [],
      owner: this.defaultUser,
      collaborators: new Map(),
      password: opts?.password,
      trashed: false,
    });

    return { store: "memory", id };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const data = this.live(ref);

    if (data.password) {
      if (opts?.password !== undefined) {
        if (opts.password !== data.password) throw new Error("Invalid password");
        this.unlocked.add(ref.id);
      } else if (!this.unlocked.has(ref.id)) {
        throw new Error("Invalid password");
      }
    }

    // Every grade, ballot, property and reset is kept in append order; latest-wins and resets
    // are applied here (contract `history-resets`).
    const grades: Grade[] = [];
    const comments: Comment[] = [];
    const rankings: Ranking[] = [];
    const outcomes: OutcomeRecord[] = [];
    const contributions: Contribution[] = [];
    const properties: PropertyValue[] = [];
    const resets: Reset[] = [];

    for (const entry of data.entries) {
      const author = {
        id: entry.id,
        at: entry.at,
        by: entry.by,
        ...(entry.byName !== undefined ? { byName: entry.byName } : {}),
      };
      if (entry.kind === "grade") {
        grades.push({ ...author, optionId: entry.optionId, value: entry.value });
      } else if (entry.kind === "comment") {
        comments.push({
          ...author,
          optionId: entry.optionId,
          body: entry.body,
          replaces: entry.replaces,
          hidden: entry.hidden,
        });
      } else if (entry.kind === "ranking") {
        rankings.push({ ...author, round: entry.round ?? 1, ranking: entry.ranking });
      } else if (entry.kind === "outcome") {
        outcomes.push(entry.outcome);
      } else if (entry.kind === "contribution") {
        contributions.push(entry.contribution);
      } else if (entry.kind === "property") {
        properties.push(propertyRecord(entry, author));
      } else if (entry.kind === "reset") {
        resets.push(resetRecord(entry, author));
      }
    }
    const effective = effectiveEntries({ grades, rankings, properties, resets });

    return {
      project: { ...data.project },
      options: [...data.options],
      grades: effective.grades,
      comments,
      rankings: effective.rankings,
      outcomes,
      contributions,
      properties: effective.properties,
      history: effective.history,
      role: this.roleOf(data) ?? "view",
    };
  }

  async append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult> {
    const data = this.live(ref);
    const role = this.roleOf(data) ?? "view";
    if (role === "view") {
      throw new Error("PERMISSION_DENIED: View role cannot append");
    }
    // Validates the whole call (delegate, owner, entry kinds) before anything is written.
    const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
    // Property shape, known option and shared-only-by-owner (contract v1.4.0).
    checkPropertyEntries(entries, {
      optionIds: new Set(data.options.map((o) => o.id)),
      isOwner: role === "owner",
    });
    // Resets: the owner may append any; others only their own (or the delegate's) values.
    checkResetEntries(
      entries,
      delegated
        ? { isOwner: false, self: delegated.by }
        : { isOwner: role === "owner", self: this.defaultUser }
    );

    for (const entry of entries) {
      // Caller-supplied `by`/`at` are ignored: the store stamps the author itself.
      data.entries.push({
        ...(entry.kind === "ranking"
          ? { ...entry, round: entry.round ?? data.project.voting.round }
          : entry),
        id: newId(entry.kind),
        by: delegated?.by ?? this.defaultUser,
        ...(delegated?.byName !== undefined ? { byName: delegated.byName } : {}),
        // Strictly increasing, so a reset clears exactly the entries appended before it.
        at: monotonicNow(),
      });
    }

    this.notify(ref);
    return { sent: entries.length, queued: 0 };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    const data = this.live(ref);
    this.requireOwner(data);

    for (const op of ops) {
      if (op.op === "add") {
        data.options.push(op.option);
      } else if (op.op === "update") {
        data.options = data.options.map((o) =>
          o.id === op.option.id ? { ...o, ...op.option } : o
        );
      } else if (op.op === "remove") {
        data.options = data.options.map((o) =>
          o.id === op.id ? { ...o, status: "removed" as const } : o
        );
      }
    }
    this.notify(ref);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const data = this.live(ref);
    this.requireOwner(data);
    if (patch.title !== undefined) data.project.title = patch.title;
    if (patch.description !== undefined) data.project.description = patch.description;
    if (patch.voting !== undefined) {
      data.project.voting = { ...data.project.voting, ...patch.voting };
    }
    if (patch.strategy !== undefined) {
      data.project = applyStrategyPatch(
        data.project,
        patch.strategy,
        this.defaultUser,
        monotonicNow()
      );
    }
    this.notify(ref);
  }

  async deleteProject(ref: ProjectRef): Promise<void> {
    const data = this.live(ref);
    this.requireOwner(data);
    data.trashed = true;
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    this.unlocked.delete(ref.id);
    this.listeners.delete(ref.id);
  }

  async export(ref: ProjectRef): Promise<ExportBundle> {
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: await this.openProject(ref),
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

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    const data = this.live(ref);
    this.requireOwner(data);
    for (const invite of req.inviteUsers ?? []) {
      data.collaborators.set(invite.email, invite.role);
    }
    for (const email of req.removeUsers ?? []) {
      data.collaborators.delete(email);
    }
    return this.getShareState(ref);
  }

  async getShareState(ref: ProjectRef): Promise<ShareState> {
    const data = this.live(ref);
    return {
      linkSharing: { enabled: false },
      collaborators: [
        { email: data.owner, role: "owner" },
        ...[...data.collaborators].map(([email, role]) => ({ email, role })),
      ],
    };
  }

  private live(ref: ProjectRef): StoredProject {
    const data = this.backend.projects.get(ref.id);
    if (!data || data.trashed) {
      throw new Error("Project unavailable or deleted");
    }
    return data;
  }

  private roleOf(data: StoredProject): ParticipantRole | undefined {
    if (data.owner === this.defaultUser) return "owner";
    return data.collaborators.get(this.defaultUser);
  }

  private requireOwner(data: StoredProject): void {
    if (data.owner !== this.defaultUser) {
      throw new Error("PERMISSION_DENIED: Only the owner may do this");
    }
  }

  private notify(ref: ProjectRef): void {
    const set = this.listeners.get(ref.id);
    if (!set || set.size === 0) return;
    this.openProject(ref).then(
      (snap) => {
        for (const listener of set) listener(snap);
      },
      () => {
        // A project that cannot be opened in this session (locked) has nothing to report.
      }
    );
  }
}
