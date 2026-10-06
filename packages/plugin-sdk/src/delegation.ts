import type { AppendOptions, Entry } from "./project-store.js";

/** Entry kinds an owner may record on behalf of another participant (contract v1.2.0). */
export const DELEGATABLE_ENTRY_KINDS: ReadonlySet<Entry["kind"]> = new Set([
  "grade",
  "comment",
  "ranking",
]);

export const DELEGATE_ID_MAX_LENGTH = 200;
export const DELEGATE_NAME_MAX_LENGTH = 80;

/** Author stamp a store writes on delegated entries: `by` plus an optional `byName`. */
export interface DelegatedAuthor {
  by: string;
  byName?: string;
}

/**
 * Validates `opts.onBehalfOf` for an append and returns the author stamp to use, or `undefined`
 * for an ordinary (non-delegated) append. Call it before writing anything, so a rejected call
 * writes nothing.
 *
 * Throws `INVALID_ARGUMENT` for a blank or over-long participant id or display name, and
 * `PERMISSION_DENIED` when the caller is not the project owner or an entry kind other than
 * grade, comment or ranking is delegated.
 */
export function resolveDelegatedAuthor(
  entries: readonly Entry[],
  opts: AppendOptions | undefined,
  isOwner: boolean
): DelegatedAuthor | undefined {
  const delegate = opts?.onBehalfOf;
  if (delegate === undefined) return undefined;

  const participantId: unknown = delegate.participantId;
  if (
    typeof participantId !== "string" ||
    participantId.trim().length === 0 ||
    participantId.length > DELEGATE_ID_MAX_LENGTH
  ) {
    throw new Error(
      `INVALID_ARGUMENT: onBehalfOf.participantId must be a non-blank string of at most ${DELEGATE_ID_MAX_LENGTH} characters`
    );
  }

  let byName: string | undefined;
  const displayName: unknown = delegate.displayName;
  if (displayName !== undefined) {
    const trimmed = typeof displayName === "string" ? displayName.trim() : "";
    if (trimmed.length === 0 || trimmed.length > DELEGATE_NAME_MAX_LENGTH) {
      throw new Error(
        `INVALID_ARGUMENT: onBehalfOf.displayName must be 1 to ${DELEGATE_NAME_MAX_LENGTH} characters after trimming`
      );
    }
    byName = trimmed;
  }

  if (!isOwner) {
    throw new Error("PERMISSION_DENIED: Only the project owner may append on behalf of others");
  }

  const refused = entries.find((e) => !DELEGATABLE_ENTRY_KINDS.has(e.kind));
  if (refused) {
    throw new Error(
      `PERMISSION_DENIED: '${refused.kind}' entries cannot be appended on behalf of others`
    );
  }

  return byName === undefined ? { by: participantId } : { by: participantId, byName };
}

/**
 * Reads a stored `byName` leniently: returns the trimmed name when it is a 1–80 character string,
 * otherwise `undefined` (never throws), so a malformed value cannot make a row unreadable.
 */
export function readStoredByName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= DELEGATE_NAME_MAX_LENGTH ? trimmed : undefined;
}
