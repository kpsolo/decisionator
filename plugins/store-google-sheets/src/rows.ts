import {
  type Comment,
  CommentSchema,
  type Contribution,
  ContributionSchema,
  type Grade,
  GradeSchema,
  type Option,
  OptionSchema,
  type OutcomeRecord,
  OutcomeRecordSchema,
  type Ranking,
  RankingSchema,
} from "@decisionator/core";
import { readStoredByName } from "@decisionator/plugin-sdk";

export interface RowDecodeResult<T> {
  entity?: T;
  warning?: string;
  unknownParticipant?: boolean;
}

export type PayloadHook = (payloadStr: string) => Promise<string> | string;

/** `byName` lives inside the JSON payload so the sheet layout stays unchanged. Read leniently. */
export function byNameField(parsed: unknown): { byName?: string } {
  const byName = readStoredByName((parsed as { byName?: unknown } | null)?.byName);
  return byName === undefined ? {} : { byName };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Option Row Codec
 * Tab: options (id, order, status, at, by, payload)
 */
export async function decodeOptionRow(
  row: string[],
  rowIndex: number,
  payloadHook?: PayloadHook
): Promise<RowDecodeResult<Option>> {
  const [id, orderStr, status, at, by, rawPayload] = row;
  if (!rawPayload) {
    return { warning: `options row ${rowIndex}: empty payload column` };
  }

  let jsonStr = rawPayload;
  if (payloadHook) {
    try {
      jsonStr = await payloadHook(rawPayload);
    } catch (err: unknown) {
      return {
        warning: `options row ${rowIndex}: failed to decrypt/process payload (${errorMessage(err)})`,
      };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    // The payload is authoritative; the columns only fill fields it lacks. The `by` column holds
    // the owner who last rewrote the tab, not necessarily the option's author.
    const parseRes = OptionSchema.safeParse({
      ...parsed,
      id: parsed.id ?? id,
      order: parsed.order ?? (orderStr ? Number.parseInt(orderStr, 10) : undefined),
      status: parsed.status ?? (status || undefined),
      at: parsed.at ?? (at || undefined),
      by: parsed.by ?? (by || undefined),
    });

    if (!parseRes.success) {
      return {
        warning: `options row ${rowIndex}: validation failed (${parseRes.error.issues.map((i) => i.message).join(", ")})`,
      };
    }

    return { entity: parseRes.data };
  } catch (err: unknown) {
    return { warning: `options row ${rowIndex}: invalid JSON payload (${errorMessage(err)})` };
  }
}

export async function encodeOptionRow(
  option: Option,
  authorParticipantId: string,
  payloadHook?: PayloadHook
): Promise<string[]> {
  let payloadStr = JSON.stringify(option);
  if (payloadHook) {
    payloadStr = await payloadHook(payloadStr);
  }
  return [
    option.id,
    String(option.order ?? 0),
    option.status,
    option.at || new Date().toISOString(),
    authorParticipantId,
    payloadStr,
  ];
}

/**
 * Grade Row Codec
 * Tab: grades (id, at, by, optionId, payload)
 */
export async function decodeGradeRow(
  row: string[],
  rowIndex: number,
  knownParticipants?: Set<string>,
  payloadHook?: PayloadHook
): Promise<RowDecodeResult<Grade>> {
  const [id, at, by, optionId, rawPayload] = row;
  if (!rawPayload) {
    return { warning: `grades row ${rowIndex}: empty payload column` };
  }

  let jsonStr = rawPayload;
  if (payloadHook) {
    try {
      jsonStr = await payloadHook(rawPayload);
    } catch (err: unknown) {
      return {
        warning: `grades row ${rowIndex}: failed to decrypt payload (${errorMessage(err)})`,
      };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const candidate = {
      id: id || "grade",
      at: at || "",
      by: by || "",
      optionId: optionId || "",
      value: parsed.value,
      ...byNameField(parsed),
    };
    const parseRes = GradeSchema.safeParse(candidate);
    if (!parseRes.success) {
      return {
        warning: `grades row ${rowIndex}: validation failed (${parseRes.error.issues.map((i) => i.message).join(", ")})`,
      };
    }

    const isUnknown = knownParticipants && by ? !knownParticipants.has(by) : false;
    return { entity: parseRes.data, unknownParticipant: isUnknown };
  } catch (err: unknown) {
    return { warning: `grades row ${rowIndex}: invalid JSON payload (${errorMessage(err)})` };
  }
}

export async function encodeGradeRow(grade: Grade, payloadHook?: PayloadHook): Promise<string[]> {
  let payloadStr = JSON.stringify({ value: grade.value, byName: grade.byName });
  if (payloadHook) {
    payloadStr = await payloadHook(payloadStr);
  }
  return [grade.id, grade.at, grade.by, grade.optionId, payloadStr];
}

/**
 * Comment Row Codec
 * Tab: comments (id, at, by, optionId, payload)
 */
export async function decodeCommentRow(
  row: string[],
  rowIndex: number,
  knownParticipants?: Set<string>,
  payloadHook?: PayloadHook
): Promise<RowDecodeResult<Comment>> {
  const [id, at, by, optionId, rawPayload] = row;
  if (!rawPayload) {
    return { warning: `comments row ${rowIndex}: empty payload column` };
  }

  let jsonStr = rawPayload;
  if (payloadHook) {
    try {
      jsonStr = await payloadHook(rawPayload);
    } catch (err: unknown) {
      return {
        warning: `comments row ${rowIndex}: failed to decrypt payload (${errorMessage(err)})`,
      };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const candidate = {
      id: id || "comment",
      at: at || "",
      by: by || "",
      optionId: optionId || "",
      ...byNameField(parsed),
      body: parsed.body,
      replaces: parsed.replaces,
      hidden: parsed.hidden,
    };
    const parseRes = CommentSchema.safeParse(candidate);
    if (!parseRes.success) {
      return {
        warning: `comments row ${rowIndex}: validation failed (${parseRes.error.issues.map((i) => i.message).join(", ")})`,
      };
    }

    const isUnknown = knownParticipants && by ? !knownParticipants.has(by) : false;
    return { entity: parseRes.data, unknownParticipant: isUnknown };
  } catch (err: unknown) {
    return { warning: `comments row ${rowIndex}: invalid JSON payload (${errorMessage(err)})` };
  }
}

export async function encodeCommentRow(
  comment: Comment,
  payloadHook?: PayloadHook
): Promise<string[]> {
  let payloadStr = JSON.stringify({
    body: comment.body,
    replaces: comment.replaces,
    hidden: comment.hidden,
    byName: comment.byName,
  });
  if (payloadHook) {
    payloadStr = await payloadHook(payloadStr);
  }
  return [comment.id, comment.at, comment.by, comment.optionId, payloadStr];
}

/**
 * Ranking Row Codec
 * Tab: rankings (id, at, by, payload)
 */
export async function decodeRankingRow(
  row: string[],
  rowIndex: number,
  knownParticipants?: Set<string>,
  payloadHook?: PayloadHook
): Promise<RowDecodeResult<Ranking>> {
  const [id, at, by, rawPayload] = row;
  if (!rawPayload) {
    return { warning: `rankings row ${rowIndex}: empty payload column` };
  }

  let jsonStr = rawPayload;
  if (payloadHook) {
    try {
      jsonStr = await payloadHook(rawPayload);
    } catch (err: unknown) {
      return {
        warning: `rankings row ${rowIndex}: failed to decrypt payload (${errorMessage(err)})`,
      };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const candidate = {
      id: id || "ranking",
      at: at || "",
      by: by || "",
      round: parsed.round ?? 1,
      ranking: parsed.ranking,
      ...byNameField(parsed),
    };
    const parseRes = RankingSchema.safeParse(candidate);
    if (!parseRes.success) {
      return {
        warning: `rankings row ${rowIndex}: validation failed (${parseRes.error.issues.map((i) => i.message).join(", ")})`,
      };
    }

    const isUnknown = knownParticipants && by ? !knownParticipants.has(by) : false;
    return { entity: parseRes.data, unknownParticipant: isUnknown };
  } catch (err: unknown) {
    return { warning: `rankings row ${rowIndex}: invalid JSON payload (${errorMessage(err)})` };
  }
}

export async function encodeRankingRow(
  ranking: Ranking,
  payloadHook?: PayloadHook
): Promise<string[]> {
  let payloadStr = JSON.stringify({
    ranking: ranking.ranking,
    round: ranking.round,
    byName: ranking.byName,
  });
  if (payloadHook) {
    payloadStr = await payloadHook(payloadStr);
  }
  return [ranking.id, ranking.at, ranking.by, payloadStr];
}

/**
 * Outcome Row Codec
 * Tab: outcomes (id, at, by, payload)
 */
export async function decodeOutcomeRow(
  row: string[],
  rowIndex: number,
  payloadHook?: PayloadHook
): Promise<RowDecodeResult<OutcomeRecord>> {
  const [, , , rawPayload] = row;
  if (!rawPayload) {
    return { warning: `outcomes row ${rowIndex}: empty payload column` };
  }

  let jsonStr = rawPayload;
  if (payloadHook) {
    try {
      jsonStr = await payloadHook(rawPayload);
    } catch (err: unknown) {
      return {
        warning: `outcomes row ${rowIndex}: failed to decrypt payload (${errorMessage(err)})`,
      };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const parseRes = OutcomeRecordSchema.safeParse(parsed);
    if (!parseRes.success) {
      return {
        warning: `outcomes row ${rowIndex}: validation failed (${parseRes.error.issues.map((i) => i.message).join(", ")})`,
      };
    }
    return { entity: parseRes.data };
  } catch (err: unknown) {
    return { warning: `outcomes row ${rowIndex}: invalid JSON payload (${errorMessage(err)})` };
  }
}

export async function encodeOutcomeRow(
  outcome: OutcomeRecord,
  id: string,
  at: string,
  by: string,
  payloadHook?: PayloadHook
): Promise<string[]> {
  let payloadStr = JSON.stringify(outcome);
  if (payloadHook) {
    payloadStr = await payloadHook(payloadStr);
  }
  return [id, at, by, payloadStr];
}

/**
 * Contribution Row Codec
 * Tab: contributions (id, at, by, targetKind, targetId, payload)
 */
export async function decodeContributionRow(
  row: string[],
  rowIndex: number,
  payloadHook?: PayloadHook
): Promise<RowDecodeResult<Contribution>> {
  const [id, at, by, targetKind, targetId, rawPayload] = row;
  if (!rawPayload) {
    return { warning: `contributions row ${rowIndex}: empty payload column` };
  }

  let jsonStr = rawPayload;
  if (payloadHook) {
    try {
      jsonStr = await payloadHook(rawPayload);
    } catch (err: unknown) {
      return {
        warning: `contributions row ${rowIndex}: failed to decrypt payload (${errorMessage(err)})`,
      };
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const parseRes = ContributionSchema.safeParse({
      id: id || "contrib",
      at: at || "",
      by: by || "",
      targetKind: targetKind || "project",
      targetId: targetId || "",
      type: parsed.type,
      body: parsed.body,
      pros: parsed.pros,
      cons: parsed.cons,
      sources: parsed.sources,
      author: parsed.author || { kind: "human" },
      reviewStatus: parsed.reviewStatus || "pending",
    });
    if (!parseRes.success) {
      return {
        warning: `contributions row ${rowIndex}: validation failed (${parseRes.error.issues.map((i) => i.message).join(", ")})`,
      };
    }
    return { entity: parseRes.data };
  } catch (err: unknown) {
    return {
      warning: `contributions row ${rowIndex}: invalid JSON payload (${errorMessage(err)})`,
    };
  }
}
