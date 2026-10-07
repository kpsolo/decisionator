import { PROPERTY_VALUE_MAX_BYTES, propertyValueBytes } from "@decisionator/core";
import type { Entry, ProjectSnapshot } from "@decisionator/plugin-sdk";
import type { AckErrorCode, GuestEntry, LiveRole } from "./protocol.js";

export type SubmissionCheck =
  | { ok: true; entries: Entry[] }
  | { ok: false; code: AckErrorCode; message: string };

/**
 * Checks a guest's submission against the current project state. Guests may grade and comment on
 * active options, edit their own comments, set their own person-scoped option properties on
 * active options, clear their own values of one property (a reset recorded for the guest), and
 * rank while voting is open in the current round.
 */
export function checkSubmission(
  snapshot: ProjectSnapshot,
  participantId: string,
  role: LiveRole,
  submitted: GuestEntry[]
): SubmissionCheck {
  if (role !== "contribute") {
    return { ok: false, code: "read_only", message: "This session is view-only." };
  }
  const active = new Set(snapshot.options.filter((o) => o.status === "active").map((o) => o.id));
  const voting = snapshot.project.voting;
  const entries: Entry[] = [];

  for (const e of submitted) {
    if (e.kind === "grade") {
      if (!active.has(e.optionId)) return unknownOption();
      entries.push({ kind: "grade", optionId: e.optionId, value: e.value });
    } else if (e.kind === "comment") {
      if (!active.has(e.optionId)) return unknownOption();
      if (e.replaces) {
        const original = snapshot.comments.find((c) => c.id === e.replaces);
        if (!original || original.by !== participantId || original.optionId !== e.optionId) {
          return { ok: false, code: "invalid", message: "You can only edit your own comments." };
        }
      }
      entries.push({
        kind: "comment",
        optionId: e.optionId,
        body: e.body,
        ...(e.replaces ? { replaces: e.replaces } : {}),
      });
    } else if (e.kind === "property") {
      if (!active.has(e.optionId)) return unknownOption();
      if (e.scope !== "person" || propertyValueBytes(e.value) > PROPERTY_VALUE_MAX_BYTES) {
        return { ok: false, code: "invalid", message: "That change is not allowed." };
      }
      entries.push({
        kind: "property",
        optionId: e.optionId,
        plugin: e.plugin,
        key: e.key,
        scope: "person",
        value: e.value,
      });
    } else if (e.kind === "reset") {
      const ownValues =
        e.scope === "participant" &&
        e.targets.length === 1 &&
        e.targets[0] === "properties" &&
        e.plugin !== undefined &&
        e.key !== undefined;
      if (!ownValues) {
        return { ok: false, code: "invalid", message: "That change is not allowed." };
      }
      entries.push({
        kind: "reset",
        scope: "participant",
        participantId,
        targets: ["properties"],
        plugin: e.plugin,
        key: e.key,
      });
    } else if (e.kind === "ranking") {
      if (voting?.state !== "open") {
        return { ok: false, code: "voting_closed", message: "Voting is closed." };
      }
      if (e.round !== voting.round) {
        return {
          ok: false,
          code: "voting_closed",
          message: `This ballot is for round ${e.round}; voting is now in round ${voting.round}.`,
        };
      }
      if (new Set(e.ranking).size !== e.ranking.length) {
        return { ok: false, code: "invalid", message: "Each option can be ranked once." };
      }
      if (e.ranking.length > voting.topN) {
        return { ok: false, code: "invalid", message: `Rank at most ${voting.topN} options.` };
      }
      if (!e.ranking.every((id) => active.has(id))) return unknownOption();
      entries.push({ kind: "ranking", ranking: [...e.ranking], round: e.round });
    } else {
      return { ok: false, code: "invalid", message: "That change is not allowed." };
    }
  }
  return { ok: true, entries };
}

function unknownOption(): SubmissionCheck {
  return { ok: false, code: "invalid", message: "That option is no longer available." };
}

/**
 * What one guest may see: no owner-only material (agent drafts, hidden comment text, encryption
 * parameters, other people's person-scoped option properties, other people's history, resets that
 * target someone else) and, while live results are off, no one else's ballot.
 */
export function redactSnapshotFor(
  snapshot: ProjectSnapshot,
  participantId: string,
  role: LiveRole
): ProjectSnapshot {
  const { kdf: _kdf, ref: _ref, ...project } = snapshot.project;
  const voting = snapshot.project.voting;
  const hideBallots = voting?.state === "open" && voting.liveResults === false;
  return {
    project: project as ProjectSnapshot["project"],
    options: snapshot.options.filter((o) => o.status !== "removed"),
    grades: snapshot.grades,
    comments: snapshot.comments.map((c) => (c.hidden ? { ...c, body: "" } : c)),
    rankings: hideBallots
      ? snapshot.rankings.filter((r) => r.by === participantId)
      : snapshot.rankings,
    outcomes: snapshot.outcomes,
    contributions: [],
    properties: (snapshot.properties ?? []).filter(
      (p) => p.scope === "shared" || p.by === participantId
    ),
    ...(snapshot.history ? { history: redactHistory(snapshot.history, participantId) } : {}),
    role,
  };
}

/** A guest's own superseded and cleared entries, plus the resets that apply to everyone or them. */
function redactHistory(
  history: NonNullable<ProjectSnapshot["history"]>,
  participantId: string
): NonNullable<ProjectSnapshot["history"]> {
  const mine = <T extends { by: string }>(list: readonly T[]) =>
    list.filter((e) => e.by === participantId);
  return {
    grades: mine(history.grades),
    rankings: mine(history.rankings),
    properties: mine(history.properties),
    resets: history.resets.filter((r) => r.scope === "all" || r.participantId === participantId),
  };
}
