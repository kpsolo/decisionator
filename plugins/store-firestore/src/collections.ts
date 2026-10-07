import type {
  Comment,
  Contribution,
  Grade,
  Option,
  OutcomeRecord,
  Project,
  PropertyScalar,
  PropertyScope,
  Ranking,
  ResetTarget,
} from "@decisionator/core";
import type { ParticipantRole } from "@decisionator/plugin-sdk";

export interface FirestoreProjectDoc {
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
  trashed?: boolean;
  collaborators: {
    email: string;
    role: ParticipantRole;
  }[];
  /**
   * Chosen decision strategy (ProjectStore 1.4.0). In protected projects: its JSON, encrypted
   * (`enc:v1:`), like the title.
   */
  strategy?: NonNullable<Project["strategy"]> | string;
  /** The last 20 strategy changes. In protected projects: their JSON, encrypted. */
  strategyChanges?: NonNullable<Project["strategyChanges"]> | string;
}

export interface FirestoreOptionDoc {
  id: string;
  order: number;
  status: "active" | "removed" | "proposed";
  title: string;
  description: string;
  category?: string;
  tags: string[];
  pros: string[];
  cons: string[];
  effort?: "XS" | "S" | "M" | "L" | "XL";
  links: { title?: string; url: string }[];
  at: string;
  by: string;
}

export type FirestoreEntryDoc =
  | {
      id: string;
      kind: "grade";
      optionId: string;
      value: 1 | 2 | 3 | 4 | 5;
      by: string;
      byName?: string;
      at: string;
    }
  | {
      id: string;
      kind: "comment";
      optionId: string;
      body: string;
      by: string;
      byName?: string;
      at: string;
      hidden?: boolean;
      replaces?: string;
    }
  | {
      id: string;
      kind: "ranking";
      ranking: string[];
      round: number;
      by: string;
      byName?: string;
      at: string;
    }
  | {
      id: string;
      kind: "outcome";
      outcome: OutcomeRecord;
      by: string;
      at: string;
    }
  | {
      id: string;
      kind: "contribution";
      contribution: Contribution;
      by: string;
      at: string;
    }
  | {
      id: string;
      kind: "property";
      optionId: string;
      plugin: string;
      key: string;
      scope: PropertyScope;
      /** In protected projects: the JSON of the value, encrypted (`enc:v1:`). */
      value: PropertyScalar;
      by: string;
      byName?: string;
      at: string;
    }
  | {
      id: string;
      kind: "reset";
      scope: "all" | "participant";
      participantId?: string;
      targets: ResetTarget[];
      round?: number;
      plugin?: string;
      key?: string;
      by: string;
      byName?: string;
      at: string;
    };
