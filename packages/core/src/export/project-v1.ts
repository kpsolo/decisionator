import { z } from "zod";
import { ContributionSchema } from "../model/contribution.js";
import { CommentSchema, GradeSchema, RankingSchema } from "../model/entries.js";
import { ResetSchema } from "../model/history.js";
import { OptionSchema } from "../model/option.js";
import { OutcomeRecordSchema } from "../model/outcome.js";
import { ProjectSchema } from "../model/project.js";
import { PropertyValueSchema } from "../model/property.js";

export const PROJECT_EXPORT_FORMAT = "decisionator.project/v1";

export const ProjectExportV1Schema = z.object({
  format: z.literal(PROJECT_EXPORT_FORMAT),
  exportedAt: z.string().datetime(),
  project: ProjectSchema,
  options: z.array(OptionSchema),
  grades: z.array(GradeSchema),
  comments: z.array(CommentSchema),
  rankings: z.array(RankingSchema),
  outcomes: z.array(OutcomeRecordSchema),
  /** Agent / human contributions (notes, research, pros & cons). Absent in pre-0.2 bundles. */
  contributions: z.array(ContributionSchema).optional().default([]),
  /** Plugin option property values, shared and per person (latest per slot). Absent before 005. */
  properties: z.array(PropertyValueSchema).optional().default([]),
  /**
   * Superseded and cleared grades, ballots and property values, oldest first (contract
   * `history-resets`). Absent before 005 US5.
   */
  history: z
    .object({
      grades: z.array(GradeSchema).optional().default([]),
      rankings: z.array(RankingSchema).optional().default([]),
      properties: z.array(PropertyValueSchema).optional().default([]),
    })
    .optional()
    .default({}),
  /** Every reset entry, in append order. Absent before 005 US6. */
  resets: z.array(ResetSchema).optional().default([]),
});

export type ProjectExportV1 = z.infer<typeof ProjectExportV1Schema>;
export type ProjectExportV1Input = z.input<typeof ProjectExportV1Schema>;

export function createProjectExport(
  data: Omit<ProjectExportV1Input, "format" | "exportedAt">
): ProjectExportV1 {
  return ProjectExportV1Schema.parse({
    format: PROJECT_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    ...data,
  });
}

/** File name stem for exports: the title, lower-cased, with runs of other characters as `-`. */
export function exportFileStem(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}
