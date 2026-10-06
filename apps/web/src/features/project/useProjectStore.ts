import type { ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useStorage } from "../../storage/StorageContext.js";

export interface ProjectRoute {
  /** Project id from `/p/:storeId/:id/...` or the legacy `/p/:fileId/...`. */
  projectId: string;
  storeId: string;
  projectRef: ProjectRef;
  /** The store that owns this project (local file, Firestore or Google Sheets). */
  store: ProjectStore;
  /** `/p/:storeId/:id`, for links to the project's sub-pages. */
  baseUrl: string;
}

/**
 * Resolves the current route's project and its store. Every project page must use this rather
 * than constructing a specific store, so local-file and Firestore projects work everywhere.
 */
export function useProjectStore(): ProjectRoute {
  const { fileId, storeId: routeStoreId, id } = useParams();
  const { storageManager } = useStorage();

  const projectId = id || fileId || "";
  // Legacy links carry no store segment; infer it from the id prefix.
  const storeId =
    routeStoreId ||
    (projectId.startsWith("file_")
      ? "file"
      : projectId.startsWith("fs_")
        ? "firestore"
        : "google-sheets");

  const projectRef = useMemo<ProjectRef>(
    () => ({ store: storeId, id: projectId }),
    [storeId, projectId]
  );
  const store = useMemo(
    () => storageManager.resolveStore(projectRef),
    [storageManager, projectRef]
  );

  return { projectId, storeId, projectRef, store, baseUrl: `/p/${storeId}/${projectId}` };
}
