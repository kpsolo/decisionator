import type { Comment, Grade, Option, OutcomeRecord, Project, Ranking } from "@decisionator/core";
import type {
  AppendResult,
  Entry,
  ExportBundle,
  Identity,
  MetaPatch,
  NewProject,
  OptionOp,
  ProjectRef,
  ProjectSnapshot,
  ProjectStore,
  ProjectSummary,
  ShareRequest,
  ShareState,
  Unsubscribe,
} from "@decisionator/plugin-sdk";

export class MemoryProjectStore implements ProjectStore {
  readonly id = "org.decisionator.examples.store.memory";

  private projects = new Map<
    string,
    {
      project: Project;
      options: Option[];
      entries: (Entry & { by?: string; at?: string })[];
      owner: string;
      password?: string;
      trashed?: boolean;
    }
  >();

  constructor(private defaultUser = "alice@example.com") {}

  async signIn(): Promise<Identity> {
    return {
      participantId: this.defaultUser,
      displayName: this.defaultUser.split("@")[0] || this.defaultUser,
      email: this.defaultUser,
    };
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const list: ProjectSummary[] = [];
    for (const [id, data] of this.projects.entries()) {
      if (!data.trashed) {
        list.push({
          ref: { store: "memory", id },
          title: data.project.title,
          owner: data.owner,
        });
      }
    }
    return list;
  }

  async createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const project: Project = {
      title: input.title,
      description: input.description || "",
      protected: Boolean(opts?.password),
      voting: input.voting ?? { state: "open", round: 1, topN: 3, liveResults: true },
      formatVersion: 1,
    };

    this.projects.set(id, {
      project,
      options: (input.options || []).map((o, idx) => ({ ...o, order: o.order ?? idx + 1 })),
      entries: [],
      owner: this.defaultUser,
      password: opts?.password,
      trashed: false,
    });

    return { store: "memory", id };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const data = this.projects.get(ref.id);
    if (!data || data.trashed) {
      throw new Error("Project unavailable or deleted");
    }

    if (data.password) {
      if (!opts?.password || opts.password !== data.password) {
        throw new Error("Invalid password");
      }
    }

    const grades: Grade[] = [];
    const comments: Comment[] = [];
    const rankings: Ranking[] = [];
    const outcomes: OutcomeRecord[] = [];

    for (const entry of data.entries) {
      if (entry.kind === "grade") {
        const existingIdx = grades.findIndex(
          (g) => g.by === entry.by && g.optionId === entry.optionId
        );
        const gradeObj: Grade = {
          id: "g",
          at: entry.at || new Date().toISOString(),
          by: entry.by || this.defaultUser,
          optionId: entry.optionId,
          value: entry.value,
        };
        if (existingIdx >= 0) {
          grades[existingIdx] = gradeObj;
        } else {
          grades.push(gradeObj);
        }
      } else if (entry.kind === "comment") {
        comments.push({
          id: "c",
          at: entry.at || new Date().toISOString(),
          by: entry.by || this.defaultUser,
          optionId: entry.optionId,
          body: entry.body,
          replaces: entry.replaces,
          hidden: entry.hidden,
        });
      } else if (entry.kind === "ranking") {
        const existingIdx = rankings.findIndex(
          (r) => r.by === entry.by && r.round === (entry.round ?? 1)
        );
        const rankObj: Ranking = {
          id: "r",
          at: entry.at || new Date().toISOString(),
          by: entry.by || this.defaultUser,
          round: entry.round ?? 1,
          ranking: entry.ranking,
        };
        if (existingIdx >= 0) {
          rankings[existingIdx] = rankObj;
        } else {
          rankings.push(rankObj);
        }
      } else if (entry.kind === "outcome") {
        outcomes.push(entry.outcome);
      }
    }

    return {
      project: data.project,
      options: data.options,
      grades,
      comments,
      rankings,
      outcomes,
      role: data.owner === this.defaultUser ? "owner" : "contribute",
    };
  }

  async append(ref: ProjectRef, entries: Entry[]): Promise<AppendResult> {
    const data = this.projects.get(ref.id);
    if (!data || data.trashed) {
      throw new Error("Project unavailable");
    }

    for (const entry of entries) {
      data.entries.push({
        ...entry,
        by: (entry as { by?: string }).by || this.defaultUser,
        at: (entry as { at?: string }).at || new Date().toISOString(),
      });
    }

    return { sent: entries.length, queued: 0 };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    const data = this.projects.get(ref.id);
    if (!data) throw new Error("Not found");
    if (data.owner !== this.defaultUser) {
      throw new Error("PERMISSION_DENIED");
    }

    for (const op of ops) {
      if (op.op === "add") {
        data.options.push(op.option);
      } else if (op.op === "update") {
        data.options = data.options.map((o) => (o.id === op.option.id ? op.option : o));
      } else if (op.op === "remove") {
        data.options = data.options.map((o) => (o.id === op.id ? { ...o, status: "removed" } : o));
      }
    }
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const data = this.projects.get(ref.id);
    if (!data) throw new Error("Not found");
    if (patch.title !== undefined) data.project.title = patch.title;
    if (patch.description !== undefined) data.project.description = patch.description;
    if (patch.voting !== undefined) {
      data.project.voting = { ...data.project.voting, ...patch.voting };
    }
  }

  async deleteProject(ref: ProjectRef): Promise<void> {
    const data = this.projects.get(ref.id);
    if (!data) throw new Error("Not found");
    if (data.owner !== this.defaultUser) {
      throw new Error("PERMISSION_DENIED");
    }
    data.trashed = true;
  }

  async export(ref: ProjectRef): Promise<ExportBundle> {
    const snap = await this.openProject(ref);
    return {
      format: "decisionator.export/v1",
      exportedAt: new Date().toISOString(),
      project: snap.project,
      options: snap.options,
      grades: snap.grades,
      comments: snap.comments,
      rankings: snap.rankings,
      outcomes: snap.outcomes,
    };
  }

  watch(_ref: ProjectRef, _onChange: (s: ProjectSnapshot) => void): Unsubscribe {
    return () => {};
  }

  async share(_ref: ProjectRef, _req: ShareRequest): Promise<ShareState> {
    return { mode: "link", access: "contribute", linkEnabled: true, emailInvites: [] };
  }

  async getShareState(_ref: ProjectRef): Promise<ShareState> {
    return { mode: "link", access: "contribute", linkEnabled: true, emailInvites: [] };
  }
}
