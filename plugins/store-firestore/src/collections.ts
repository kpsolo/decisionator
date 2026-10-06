import type {
  Comment,
  Contribution,
  Grade,
  Option,
  OutcomeRecord,
  Project,
  Ranking,
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
      at: string;
    }
  | {
      id: string;
      kind: "comment";
      optionId: string;
      body: string;
      by: string;
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
    };
