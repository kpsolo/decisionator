import { z } from "zod";
import {
  CommentSchema,
  GradeSchema,
  OptionSchema,
  OutcomeRecordSchema,
  ProjectSchema,
  RankingSchema,
} from "../index.js";

export const ProjectExportV1Schema = z.object({
  format: z.literal("decisionator.project/v1"),
  exportedAt: z.string().datetime(),
  project: ProjectSchema,
  options: z.array(OptionSchema),
  grades: z.array(GradeSchema),
  comments: z.array(CommentSchema),
  rankings: z.array(RankingSchema),
  outcomes: z.array(OutcomeRecordSchema),
});

export type ProjectExportV1 = z.infer<typeof ProjectExportV1Schema>;

export function createProjectExport(
  data: Omit<ProjectExportV1, "format" | "exportedAt">
): ProjectExportV1 {
  const exportPayload: ProjectExportV1 = {
    format: "decisionator.project/v1",
    exportedAt: new Date().toISOString(),
    ...data,
  };
  return ProjectExportV1Schema.parse(exportPayload);
}
