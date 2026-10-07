import { z } from "zod";

/**
 * Plugin-defined option properties (contract `option-properties` 1.0.0). A plugin declares them in
 * its manifest; values are stored as `property` entries, shared per option or per person.
 */

export const PROPERTY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** Largest JSON-serialized `value` a store accepts. */
export const PROPERTY_VALUE_MAX_BYTES = 2048;

export const PropertyTypeSchema = z.enum(["text", "number", "boolean", "choice", "date"]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PropertyScopeSchema = z.enum(["shared", "person"]);
export type PropertyScope = z.infer<typeof PropertyScopeSchema>;

export const PropertyScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type PropertyScalar = z.infer<typeof PropertyScalarSchema>;

const PropertyKeySchema = z
  .string()
  .regex(PROPERTY_KEY_PATTERN, "must start with a lowercase letter and use only a-z, 0-9 and _");

export const OptionPropertyDefinitionSchema = z
  .object({
    key: PropertyKeySchema,
    label: z.string().trim().min(1).max(40),
    type: PropertyTypeSchema,
    choices: z
      .array(z.object({ value: PropertyKeySchema, label: z.string().trim().min(1).max(40) }))
      .min(1)
      .max(20)
      .optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    scope: PropertyScopeSchema,
    cardBadge: z.boolean().default(false),
    hidden: z.boolean().default(false),
  })
  .superRefine((def, ctx) => {
    if (def.type === "choice" && !def.choices) {
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "required for a choice property",
      });
    }
    if (def.type !== "choice" && def.choices) {
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "only allowed for a choice property",
      });
    }
    if (def.choices) {
      const values = def.choices.map((c) => c.value);
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: "custom",
          path: ["choices"],
          message: "choice values must be unique",
        });
      }
    }
    if (def.default !== undefined) {
      const check = checkPropertyValue(def as OptionPropertyDefinition, def.default);
      if (!check.ok) ctx.addIssue({ code: "custom", path: ["default"], message: check.message });
    }
  });
export type OptionPropertyDefinition = z.output<typeof OptionPropertyDefinitionSchema>;
export type OptionPropertyDefinitionInput = z.input<typeof OptionPropertyDefinitionSchema>;

export const PropertyValueSchema = z.object({
  id: z.string(),
  at: z.string(),
  by: z.string(),
  byName: z.string().optional(),
  optionId: z.string(),
  plugin: z.string().min(1).max(200),
  key: PropertyKeySchema,
  scope: PropertyScopeSchema,
  value: PropertyScalarSchema,
});
export type PropertyValue = z.infer<typeof PropertyValueSchema>;

export type PropertyCheck = { ok: true } | { ok: false; message: string };

/** Checks a value against its declaration. `null` always passes: it clears the value. */
export function checkPropertyValue(
  def: Pick<OptionPropertyDefinition, "label" | "type" | "choices">,
  value: unknown
): PropertyCheck {
  if (value === null) return { ok: true };
  const fail = (expected: string): PropertyCheck => ({
    ok: false,
    message: `${def.label}: ${expected}`,
  });
  switch (def.type) {
    case "text":
      return typeof value === "string" && value.length >= 1 && value.length <= 500
        ? { ok: true }
        : fail("enter text of 1 to 500 characters");
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true }
        : fail("enter a number");
    case "boolean":
      return typeof value === "boolean" ? { ok: true } : fail("choose yes or no");
    case "choice":
      return typeof value === "string" && (def.choices ?? []).some((c) => c.value === value)
        ? { ok: true }
        : fail(`choose one of ${(def.choices ?? []).map((c) => c.label).join(", ")}`);
    case "date":
      return typeof value === "string" && isCalendarDate(value)
        ? { ok: true }
        : fail("enter a date as YYYY-MM-DD");
  }
}

function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Latest-wins identity of a value: per option for shared, per option and author for person. */
export function propertySlot(
  v: Pick<PropertyValue, "plugin" | "key" | "optionId" | "scope" | "by">
): string {
  const base = `${v.plugin}\u0000${v.key}\u0000${v.optionId}`;
  return v.scope === "shared" ? `s\u0000${base}` : `p\u0000${v.by}\u0000${base}`;
}

/**
 * Effective values: the newest entry per slot (later in the list wins on equal `at`). Cleared
 * values (`null`) stay, so a store's latest-wins keeps the clear; callers that only want set
 * values filter `value !== null`.
 */
export function effectivePropertyValues(values: readonly PropertyValue[]): PropertyValue[] {
  const latest = new Map<string, PropertyValue>();
  for (const v of values) {
    const slot = propertySlot(v);
    const prev = latest.get(slot);
    if (!prev || prev.at <= v.at) latest.set(slot, v);
  }
  return [...latest.values()];
}

/** Size in bytes of a value once stored as JSON. */
export function propertyValueBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
