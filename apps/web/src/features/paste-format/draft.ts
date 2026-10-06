import type { Option } from "@decisionator/core";
import {
  type DraftRecord,
  deleteDraft as dbDeleteDraft,
  getDraft as dbGetDraft,
  saveDraft as dbSaveDraft,
} from "../../sync/db.js";

export interface DraftState {
  title: string;
  description: string;
  pastedText: string;
  aiAnswer: string;
  options: Option[];
}

export async function saveDraftState(draft: DraftState): Promise<void> {
  const record: DraftRecord = {
    id: "current",
    pastedText: draft.pastedText,
    aiAnswer: draft.aiAnswer,
    title: draft.title,
    description: draft.description,
    preview: draft.options,
    warnings: [],
    updatedAt: new Date().toISOString(),
  };
  await dbSaveDraft(record);
}

export async function loadDraftState(): Promise<DraftState | undefined> {
  const record = await dbGetDraft("current");
  if (!record) return undefined;
  return {
    title: record.title || "Untitled Decision",
    description: record.description || "",
    pastedText: record.pastedText,
    aiAnswer: record.aiAnswer || "",
    options: record.preview,
  };
}

export async function clearDraftState(): Promise<void> {
  await dbDeleteDraft("current");
}
