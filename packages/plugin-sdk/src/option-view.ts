import type { Option, PropertyScalar } from "@decisionator/core";
import { z } from "zod";

/**
 * Option view extension (contract `option-view` 1.0.0). Plugins return data; the host renders it
 * in fixed places of the option card, the option detail view and the option list. Title, grade
 * control, comments and ballot are not places, so no contribution can reach them.
 */

export const OPTION_VIEW_PLACES = ["marker", "badges", "footer", "sections", "list"] as const;
export type OptionViewPlace = (typeof OPTION_VIEW_PLACES)[number];

export const ToneSchema = z.enum(["neutral", "info", "success", "warning", "danger", "primary"]);
export type Tone = z.infer<typeof ToneSchema>;

export const OPTION_VIEW_ICONS = [
  "star",
  "flag",
  "tag",
  "coins",
  "check",
  "eye",
  "info",
  "alert",
  "clock",
  "heart",
] as const;
export const IconNameSchema = z.enum(OPTION_VIEW_ICONS);
export type IconName = z.infer<typeof IconNameSchema>;

export const MarkerSchema = z.object({
  variant: z.enum(["dot", "bar", "bold", "ring"]),
  label: z.string().trim().min(1).max(40),
  tone: ToneSchema.optional(),
  replace: z.boolean().optional(),
});
export type OptionMarker = z.infer<typeof MarkerSchema>;

export const BadgeSchema = z.object({
  text: z.string().trim().min(1).max(24),
  tone: ToneSchema.optional(),
  icon: IconNameSchema.optional(),
  title: z.string().max(120).optional(),
});
export type OptionBadge = z.infer<typeof BadgeSchema>;

export const FooterItemSchema = z.union([
  z.object({ text: z.string().trim().min(1).max(80) }).strict(),
  z
    .object({
      action: z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
        label: z.string().trim().min(1).max(40),
        /** Tooltip shown on hover, focus and long-press, e.g. when a mark was set. */
        title: z.string().trim().min(1).max(120).optional(),
      }),
    })
    .strict(),
]);
export type OptionFooterItem = z.infer<typeof FooterItemSchema>;

export const BlockSchema = z.union([
  z.object({ text: z.string().min(1).max(2000) }).strict(),
  z.object({ markdown: z.string().min(1).max(4000) }).strict(),
  z
    .object({
      fields: z
        .array(z.tuple([z.string().min(1).max(40), z.string().max(200)]))
        .min(1)
        .max(20),
    })
    .strict(),
]);
export type OptionBlock = z.infer<typeof BlockSchema>;

export const SectionSchema = z.object({
  title: z.string().trim().min(1).max(60),
  blocks: z.array(BlockSchema).min(1).max(10),
});
export type OptionSection = z.infer<typeof SectionSchema>;

export interface OptionViewContribution {
  marker?: OptionMarker | null;
  badges?: OptionBadge[];
  footer?: OptionFooterItem[];
  sections?: OptionSection[];
}

const PLACE_SCHEMAS = {
  marker: MarkerSchema.nullable(),
  badges: z.array(BadgeSchema).max(3),
  footer: z.array(FooterItemSchema).max(3),
  sections: z.array(SectionSchema).max(2),
} as const;

export const FilterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  label: z.string().trim().min(1).max(40),
  where: z.object({
    key: z.string().min(1),
    in: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .min(1)
      .max(20),
  }),
});
export type OptionListFilter = z.infer<typeof FilterSchema>;

/** A list-wide action, e.g. "Mark all as not seen"; the host asks `confirm` before running it. */
export const ListActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  label: z.string().trim().min(1).max(40),
  confirm: z.string().trim().min(1).max(200).optional(),
});
export type OptionListAction = z.infer<typeof ListActionSchema>;

export interface OptionListContribution {
  summary?: { text: string };
  filters?: OptionListFilter[];
  actions?: OptionListAction[];
}

const LIST_SCHEMAS = {
  summary: z.object({ text: z.string().trim().min(1).max(40) }),
  filters: z.array(FilterSchema).max(3),
  actions: z.array(ListActionSchema).max(2),
} as const;

export interface ValidatedContribution<T> {
  value: T;
  /** Places whose content was invalid and must fall back to the default. */
  droppedPlaces: string[];
}

/**
 * Validates a plugin's contribution place by place: a bad place is dropped (the host shows its
 * default with a notice), the others are kept. Unknown keys are ignored. `surface: "card"` drops
 * `sections`, which only exist in the detail view.
 */
export function validateContribution(
  raw: unknown,
  surface: "card" | "detail"
): ValidatedContribution<OptionViewContribution> {
  const value: OptionViewContribution = {};
  const droppedPlaces: string[] = [];
  if (raw === null || typeof raw !== "object") {
    return {
      value,
      droppedPlaces: raw === undefined ? [] : ["marker", "badges", "footer", "sections"],
    };
  }
  const input = raw as Record<string, unknown>;
  for (const place of Object.keys(PLACE_SCHEMAS) as (keyof typeof PLACE_SCHEMAS)[]) {
    if (!(place in input) || input[place] === undefined) continue;
    if (place === "sections" && surface === "card") continue;
    const parsed = PLACE_SCHEMAS[place].safeParse(input[place]);
    if (parsed.success) {
      (value as Record<string, unknown>)[place] = parsed.data;
    } else {
      droppedPlaces.push(place);
    }
  }
  return { value, droppedPlaces };
}

export function validateListContribution(
  raw: unknown
): ValidatedContribution<OptionListContribution> {
  const value: OptionListContribution = {};
  const droppedPlaces: string[] = [];
  if (raw === null || typeof raw !== "object") return { value, droppedPlaces };
  const input = raw as Record<string, unknown>;
  for (const place of Object.keys(LIST_SCHEMAS) as (keyof typeof LIST_SCHEMAS)[]) {
    if (!(place in input) || input[place] === undefined) continue;
    const parsed = LIST_SCHEMAS[place].safeParse(input[place]);
    if (parsed.success) (value as Record<string, unknown>)[place] = parsed.data;
    else droppedPlaces.push(place);
  }
  return { value, droppedPlaces };
}

/** Time and author of an effective property value. */
export interface PropertyValueMeta {
  at: string;
  by: string;
}

/** What a plugin hook sees about one option. `values` are only this plugin's, viewer-visible. */
export interface OptionViewContext {
  option: Option;
  viewerId: string;
  surface: "card" | "detail";
  values: Record<string, PropertyScalar>;
  /** When and by whom each of `values` was set (the effective entries the viewer may see). */
  valueMeta: Record<string, PropertyValueMeta>;
  settings: Record<string, unknown>;
  /** Sets one of this plugin's own properties for this option (FR-012 enforced by the host). */
  setValue(key: string, value: PropertyScalar): Promise<void>;
}

export interface OptionListContext {
  /** Active options in view order. */
  options: Option[];
  viewerId: string;
  valuesByOption: Record<string, Record<string, PropertyScalar>>;
  settings: Record<string, unknown>;
  /**
   * Clears this plugin's property `key` on every option, recorded as a reset entry: the
   * viewer's own values for a `person` property, every value of a `shared` one (owner only).
   */
  resetValues(key: string): Promise<void>;
}

export interface ExposureContext {
  viewerId: string;
  settings: Record<string, unknown>;
  /** This plugin's effective values per option, viewer-visible. */
  valuesByOption: Record<string, Record<string, PropertyScalar>>;
  setValues(changes: { optionId: string; key: string; value: PropertyScalar }[]): Promise<void>;
}
