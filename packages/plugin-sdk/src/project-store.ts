import type {
  Comment,
  Contribution,
  Grade,
  Option,
  OutcomeRecord,
  Project,
  Ranking,
} from "@decisionator/core";

export type ParticipantRole = "owner" | "contribute" | "view";

export interface Identity {
  participantId: string;
  displayName: string;
  email?: string;
  role?: ParticipantRole;
}

export interface ProjectRef {
  store: string;
  id: string;
  [key: string]: unknown;
}

export interface ProjectSummary {
  ref: ProjectRef;
  title: string;
  description?: string;
  owner: string;
  updatedAt?: string;
  createdAt?: string;
  isProtected?: boolean;
}

export interface ProjectSnapshot {
  project: Project;
  options: Option[];
  grades: Grade[];
  comments: Comment[];
  rankings: Ranking[];
  outcomes: OutcomeRecord[];
  contributions?: Contribution[];
  role: ParticipantRole;
}

export type Entry =
  | { kind: "grade"; optionId: string; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: "comment"; optionId: string; body: string; hidden?: boolean; replaces?: string }
  | { kind: "ranking"; ranking: string[]; round?: number }
  | { kind: "outcome"; outcome: OutcomeRecord }
  | { kind: "contribution"; contribution: Contribution };

export interface AppendResult {
  queued: number;
  sent: number;
}

export type OptionOp =
  | { op: "add"; option: Option }
  | { op: "update"; option: Partial<Option> & { id: string } }
  | { op: "remove"; id: string };

export type MetaPatch = Partial<Pick<Project, "title" | "description" | "voting">>;

export interface ShareRequest {
  linkSharing?: {
    enabled: boolean;
    role?: "view" | "contribute";
  };
  inviteUsers?: {
    email: string;
    role: "view" | "contribute";
  }[];
  removeUsers?: string[];
}

export interface ShareState {
  linkSharing: {
    enabled: boolean;
    role?: "view" | "contribute";
    url?: string;
  };
  collaborators: {
    email: string;
    role: "owner" | "contribute" | "view";
  }[];
}

export interface ExportBundle {
  formatVersion: 1;
  exportedAt: string;
  snapshot: ProjectSnapshot;
}

export type Unsubscribe = () => void;

export interface NewProject {
  title: string;
  description?: string;
  voting?: Project["voting"];
  options?: Option[];
}

export interface ProjectStore {
  readonly id: string;
  signIn(opts?: { interactive: boolean }): Promise<Identity>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef>;
  openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot>;
  watch(ref: ProjectRef, onChange: (s: ProjectSnapshot) => void): Unsubscribe;
  append(ref: ProjectRef, entries: Entry[]): Promise<AppendResult>;
  updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void>;
  updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void>;
  share(ref: ProjectRef, req: ShareRequest): Promise<ShareState>;
  getShareState(ref: ProjectRef): Promise<ShareState>;
  export(ref: ProjectRef): Promise<ExportBundle>;
  deleteProject(ref: ProjectRef): Promise<void>;
  forgetProject(ref: ProjectRef): Promise<void>;
}
