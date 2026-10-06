import type { Option } from "@decisionator/core";
import { getStorageManager } from "../../storage/storage-manager.js";

export interface CreateProjectParams {
  title: string;
  description?: string;
  options: Option[];
  storeId?: string;
}

export async function createProjectFlow(
  params: CreateProjectParams
): Promise<{ storeId: string; fileId: string }> {
  const sm = getStorageManager();
  const store = params.storeId
    ? sm.getStore(params.storeId) || sm.getActiveStore()
    : sm.getActiveStore();

  // If store is Google Sheets, request interactive token
  if (store.id.includes("google-sheets")) {
    await store.signIn({ interactive: true });
  }

  const ref = await store.createProject({
    title: params.title,
    description: params.description,
    options: params.options,
    voting: {
      state: "open",
      round: 1,
      topN: 3,
      liveResults: true,
    },
  });

  const resolvedStoreId =
    ref.store ||
    (store.id.includes("google-sheets")
      ? "google-sheets"
      : store.id.includes("firestore")
        ? "firestore"
        : "file");

  return { storeId: resolvedStoreId, fileId: ref.id };
}
