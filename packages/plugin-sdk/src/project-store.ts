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
  /**
   * Stored records the store skipped because they failed validation (contract v1.3.0), e.g.
   * `"grades row 7: invalid JSON payload (...)"`. Absent when nothing was skipped.
   */
  warnings?: string[];
}

export type Entry =
  | { kind: "grade"; optionId: string; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: "comment"; optionId: string; body: string; hidden?: boolean; replaces?: string }
  | { kind: "ranking"; ranking: string[]; round?: number }
  | { kind: "outcome"; outcome: OutcomeRecord }
  | { kind: "contribution"; contribution: Contribution };

/**
 * A participant whose entries the project owner records, e.g. a guest in a live session or the
 * original author when a project is moved between stores (contract v1.2.0).
 */
export interface Delegate {
  /** Stable id the entries are attributed to (`by`). Must not be empty; at most 200 characters. */
  participantId: string;
  /** Human-readable name stored alongside the entries (`byName`). At most 80 characters. */
  displayName?: string;
}

export interface AppendOptions {
  /**
   * Record the entries for this participant instead of the signed-in user. Only the project owner
   * may delegate, and only `grade`, `comment` and `ranking` entries; anything else is rejected
   * with `PERMISSION_DENIED`.
   */
  onBehalfOf?: Delegate;
}

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
  append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult>;
  updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void>;
  updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void>;
  share(ref: ProjectRef, req: ShareRequest): Promise<ShareState>;
  getShareState(ref: ProjectRef): Promise<ShareState>;
  export(ref: ProjectRef): Promise<ExportBundle>;
  deleteProject(ref: ProjectRef): Promise<void>;
  forgetProject(ref: ProjectRef): Promise<void>;
}
