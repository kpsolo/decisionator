import type { OutcomeRecord, Project } from "@decisionator/core";
import type { ProjectRef, ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";

type Voting = NonNullable<Project["voting"]>;
type Grade = ProjectSnapshot["grades"][number];

export const DEFAULT_VOTING: Voting = { state: "open", round: 1, topN: 3, liveResults: true };

/** A readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Closes voting and records its outcome as one step. Voting is closed first so no ballot lands
 * after the tally; if recording the outcome then fails, the previous voting state is restored so
 * voting never stays closed without an outcome. Throws when the step did not complete.
 */
export async function closeVotingWithOutcome(
  store: Pick<ProjectStore, "updateMeta" | "append">,
  ref: ProjectRef,
  previous: Project["voting"] | undefined,
  outcome: OutcomeRecord
): Promise<void> {
  const before = previous ?? DEFAULT_VOTING;
  await store.updateMeta(ref, { voting: { ...before, state: "closed" } });
  try {
    await store.append(ref, [{ kind: "outcome", outcome }]);
  } catch (err) {
    try {
      await store.updateMeta(ref, { voting: before });
    } catch (rollbackErr) {
      throw new Error(
        `The outcome was not saved (${errorMessage(err)}) and voting could not be reopened (${errorMessage(rollbackErr)}). Reopen voting and try again.`
      );
    }
    throw new Error(`The outcome was not saved: ${errorMessage(err)}. Voting is still open.`);
  }
}

/** The snapshot with `by`'s grade for `optionId` replaced by `grade` (or removed when absent). */
export function withGrade(
  snapshot: ProjectSnapshot,
  by: string,
  optionId: string,
  grade: Grade | undefined
): ProjectSnapshot {
  const grades = snapshot.grades.filter((g) => !(g.by === by && g.optionId === optionId));
  return { ...snapshot, grades: grade ? [...grades, grade] : grades };
}

/**
 * Undoes an optimistic grade: only when the optimistic entry is still the viewer's grade for the
 * option (a later grade, or a store refresh, wins), restores the grade it replaced.
 */
export function rollbackGrade(
  snapshot: ProjectSnapshot,
  optimistic: Grade,
  previous: Grade | undefined
): ProjectSnapshot {
  if (!snapshot.grades.some((g) => g.id === optimistic.id)) return snapshot;
  return withGrade(snapshot, optimistic.by, optimistic.optionId, previous);
}
