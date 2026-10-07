import {
  PROPERTY_KEY_PATTERN,
  PROPERTY_VALUE_MAX_BYTES,
  type PropertyValue,
  propertyValueBytes,
} from "@decisionator/core";
import type { Entry } from "./project-store.js";

type PropertyEntry = Extract<Entry, { kind: "property" }>;

/**
 * Shape and permission checks every store applies to `property` entries before writing anything
 * (ProjectStore contract v1.4.0, rules 2, 4 and 5). Stores do not know plugin declarations, so
 * value types are checked by the host, not here.
 *
 * Throws `INVALID_ARGUMENT` for a malformed entry, an unknown option or a value over 2 KiB, and
 * `PERMISSION_DENIED` when someone other than the owner writes a shared value.
 */
export function checkPropertyEntries(
  entries: readonly Entry[],
  ctx: { optionIds: ReadonlySet<string>; isOwner: boolean }
): void {
  for (const e of entries) {
    if (e.kind !== "property") continue;
    checkPropertyEntryShape(e);
    if (!ctx.optionIds.has(e.optionId)) {
      throw new Error(`INVALID_ARGUMENT: unknown option '${e.optionId}'`);
    }
    if (e.scope === "shared" && !ctx.isOwner) {
      throw new Error("PERMISSION_DENIED: only the project owner may set shared option properties");
    }
  }
}

export function checkPropertyEntryShape(e: PropertyEntry): void {
  if (typeof e.plugin !== "string" || e.plugin.length === 0 || e.plugin.length > 200) {
    throw new Error("INVALID_ARGUMENT: property.plugin must be a plugin id");
  }
  if (typeof e.key !== "string" || !PROPERTY_KEY_PATTERN.test(e.key)) {
    throw new Error(`INVALID_ARGUMENT: property.key '${String(e.key)}' is not a valid key`);
  }
  if (e.scope !== "shared" && e.scope !== "person") {
    throw new Error("INVALID_ARGUMENT: property.scope must be 'shared' or 'person'");
  }
  const v: unknown = e.value;
  const scalar =
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v));
  if (!scalar) {
    throw new Error("INVALID_ARGUMENT: property.value must be a string, number, boolean or null");
  }
  if (propertyValueBytes(v) > PROPERTY_VALUE_MAX_BYTES) {
    throw new Error(
      `INVALID_ARGUMENT: property.value is larger than ${PROPERTY_VALUE_MAX_BYTES} bytes`
    );
  }
}

/** The stored record for a checked entry, once the store has stamped id, time and author. */
export function propertyRecord(
  e: PropertyEntry,
  stamp: { id: string; at: string; by: string; byName?: string }
): PropertyValue {
  return {
    id: stamp.id,
    at: stamp.at,
    by: stamp.by,
    ...(stamp.byName ? { byName: stamp.byName } : {}),
    optionId: e.optionId,
    plugin: e.plugin,
    key: e.key,
    scope: e.scope,
    value: e.value,
  };
}
