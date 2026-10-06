import type { ParticipantRole } from "@decisionator/plugin-sdk";

export interface RoleCapabilities {
  role: ParticipantRole;
  canGrade: boolean;
  canComment: boolean;
  canVote: boolean;
  canEditProject: boolean;
  canShare: boolean;
  disabledReason?: string;
}

export function useRole(role: ParticipantRole): RoleCapabilities {
  const isOwner = role === "owner";
  const isContribute = role === "contribute";
  const isView = role === "view";

  return {
    role,
    canGrade: isOwner || isContribute,
    canComment: isOwner || isContribute,
    canVote: isOwner || isContribute,
    canEditProject: isOwner,
    canShare: isOwner,
    disabledReason: isView
      ? "You have view-only access. To grade, comment, or vote, request contribute access from the project owner."
      : undefined,
  };
}
