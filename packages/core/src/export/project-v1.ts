import { z } from "zod";
import { ContributionSchema } from "../model/contribution.js";
import { CommentSchema, GradeSchema, RankingSchema } from "../model/entries.js";
import { OptionSchema } from "../model/option.js";
import { OutcomeRecordSchema } from "../model/outcome.js";
import { ProjectSchema } from "../model/project.js";

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
