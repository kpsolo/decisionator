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

/** A stand-in store whose every call rejects with the reason the real store can't be used. */
function unavailableStore(storeId: string, reason: unknown): ProjectStore {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const fail = () => Promise.reject(error);
  return {
    id: storeId,
    signIn: fail,
    listProjects: fail,
    createProject: fail,
    openProject: fail,
    watch: () => () => {},
    append: fail,
    updateOptions: fail,
    updateMeta: fail,
    share: fail,
    getShareState: fail,
    export: fail,
    deleteProject: fail,
    forgetProject: fail,
  };
}

/**
 * Resolves the current route's project and its store. Every project page must use this rather
 * than constructing a specific store, so local-file and Firestore projects work everywhere.
 */
export function useProjectStore(): ProjectRoute {
  const { fileId, storeId: routeStoreId, id } = useParams();
  const { storageManager } = useStorage();

  // If a legacy route like /p/:fileId/:subpage is accessed, :storeId might match the fileId
  // and :id might match the subpage (e.g. vote, results, stats, share) when :storeId is not a registered store.
  const isLegacySubpath =
    routeStoreId &&
    id &&
    ["vote", "results", "stats", "share"].includes(id) &&
    !["file", "firestore", "google-sheets", "memory"].some(
      (s) => routeStoreId === s || routeStoreId.endsWith(`.${s}`)
    );

  const projectId = isLegacySubpath ? routeStoreId : id || fileId || "";
  const effectiveRouteStoreId = isLegacySubpath ? undefined : routeStoreId;
  const storeId =
    effectiveRouteStoreId ||
    (projectId.startsWith("file_")
      ? "file"
      : projectId.startsWith("fs_")
        ? "firestore"
        : "google-sheets");

  const projectRef = useMemo<ProjectRef>(
    () => ({ store: storeId, id: projectId }),
    [storeId, projectId]
  );
  const store = useMemo(() => {
    try {
      return storageManager.resolveStore(projectRef);
    } catch (err) {
      // A link to a store this app doesn't have: pages show their usual "unavailable" state.
      return unavailableStore(storeId, err);
    }
  }, [storageManager, projectRef, storeId]);

  return { projectId, storeId, projectRef, store, baseUrl: `/p/${storeId}/${projectId}` };
}
