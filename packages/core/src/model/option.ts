import { z } from "zod";

export const OptionEffortSchema = z.enum(["XS", "S", "M", "L", "XL"]);
export type OptionEffort = z.infer<typeof OptionEffortSchema>;

export const OptionStatusSchema = z.enum(["active", "removed"]);
export type OptionStatus = z.infer<typeof OptionStatusSchema>;

export const OptionLinkSchema = z.object({
  title: z.string().max(200).optional(),
  url: z.string().regex(/^https?:\/\/.+/, "Must be http or https URL"),
});
export type OptionLink = z.infer<typeof OptionLinkSchema>;

export const OptionSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().optional(),
  status: OptionStatusSchema.default("active"),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional().default(""),
  category: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(10).optional().default([]),
  pros: z.array(z.string().max(300)).max(20).optional().default([]),
  cons: z.array(z.string().max(300)).max(20).optional().default([]),
  effort: OptionEffortSchema.optional(),
  links: z.array(OptionLinkSchema).max(10).optional().default([]),
  at: z.string().optional(),
  by: z.string().optional(),
});
export type Option = z.infer<typeof OptionSchema>;
