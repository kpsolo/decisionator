import type { ProjectRef, ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { errorMessage } from "./project-actions.js";

export interface LoadedProject {
  snapshot: ProjectSnapshot | null;
  setSnapshot: Dispatch<SetStateAction<ProjectSnapshot | null>>;
  loading: boolean;
  loadError: string | null;
  currentUser: string;
}

/**
 * Loads the route's project. The router reuses page components across projects, so every
 * change of project starts from a clean state, and a response for a project that is no longer
 * shown is dropped instead of overwriting the current one.
 */
export function useProjectSnapshot(
  projectId: string,
  store: ProjectStore,
  projectRef: ProjectRef
): LoadedProject {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setSnapshot(null);
    setLoadError(null);
    setLoading(true);
    (async () => {
      try {
        const identity = await store.signIn({ interactive: false });
        if (cancelled) return;
        setCurrentUser(identity.participantId);
        const snap = await store.openProject(projectRef);
        if (!cancelled) setSnapshot(snap);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, store, projectRef]);

  return { snapshot, setSnapshot, loading, loadError, currentUser };
}
