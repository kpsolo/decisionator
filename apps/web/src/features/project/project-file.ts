import {
  type ProjectExportV1,
  ProjectExportV1Schema,
  XLSX_MIME,
  createProjectExport,
  createProjectWorkbook,
  exportFileStem,
  looksLikeXlsx,
  readProjectWorkbook,
} from "@decisionator/core";
import type { ProjectRef, ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import { copyEntriesAsAuthors } from "./copy-entries.js";

export type ExportFormat = "json" | "xlsx";

/** File types accepted when opening / restoring a project. */
export const PROJECT_FILE_ACCEPT = `.json,.decisionator.json,.xlsx,application/json,${XLSX_MIME}`;

export function snapshotToExport(snapshot: ProjectSnapshot): ProjectExportV1 {
  return createProjectExport({
    project: snapshot.project,
    options: snapshot.options,
    grades: snapshot.grades,
    comments: snapshot.comments,
    rankings: snapshot.rankings,
    outcomes: snapshot.outcomes,
    contributions: snapshot.contributions ?? [],
    properties: snapshot.properties ?? [],
  });
}

export function exportFileName(title: string, format: ExportFormat): string {
  return `${exportFileStem(title)}-export.${format}`;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads the project with its options, grades, ballots, comments, outcomes, contributions
 * and option property values: a `decisionator.project/v1` JSON bundle, or the same data as an `.xlsx`
 * workbook that Excel and Google Sheets open. Either file restores the project.
 */
export function downloadProjectExport(snapshot: ProjectSnapshot, format: ExportFormat = "json") {
  const bundle = snapshotToExport(snapshot);
  const name = exportFileName(snapshot.project.title, format);
  if (format === "xlsx") {
    const bytes = createProjectWorkbook(bundle);
    saveBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MIME }), name);
  } else {
    saveBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), name);
  }
}

/** Reads a project export file (`.json` bundle or `.xlsx` workbook) into a validated bundle. */
export async function readProjectFile(file: Blob): Promise<ProjectExportV1> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeXlsx(bytes)) return readProjectWorkbook(bytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("The file is neither a project JSON bundle nor an .xlsx workbook");
  }
  const result = ProjectExportV1Schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      issue ? `${issue.path.join(".") || "File"}: ${issue.message}` : result.error.message
    );
  }
  return result.data;
}

/**
 * Re-creates an exported project in `store`: title, description, voting state and options
 * (with their IDs), then every grade, ballot and comment under its original author, the
 * outcomes (so results and verification work as before), contributions and option property
 * values (per-person ones under their author, shared ones under the restoring owner).
 */
export async function restoreProject(
  store: ProjectStore,
  bundle: ProjectExportV1
): Promise<ProjectRef> {
  const ref = await store.createProject({
    title: bundle.project.title,
    description: bundle.project.description,
    voting: bundle.project.voting,
    options: bundle.options,
  });
  await copyEntriesAsAuthors(store, ref, bundle);
  return ref;
}
