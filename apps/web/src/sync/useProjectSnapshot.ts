import type { Entry, ProjectRef, ProjectSnapshot } from "@decisionator/plugin-sdk";
import type { GoogleSheetsProjectStore, WriteQueue } from "@decisionator/store-google-sheets";
import { useCallback, useEffect, useState } from "react";

export interface UseProjectSnapshotOptions {
  store: GoogleSheetsProjectStore;
  ref: ProjectRef;
  password?: string;
  queue?: WriteQueue;
}

export interface UseProjectSnapshotResult {
  snapshot: ProjectSnapshot | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  appendOptimistic: (entries: Entry[]) => Promise<void>;
}

/**
 * Live snapshot merging hook (T071, FR-019).
 * Applies incoming live snapshots while retaining queued local unconfirmed entries
 * so no local updates are wiped before the write queue flushes.
 */
export function useProjectSnapshot({
  store,
  ref,
  password,
  queue,
}: UseProjectSnapshotOptions): UseProjectSnapshotResult {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mergeWithQueue = useCallback(
    async (incoming: ProjectSnapshot): Promise<ProjectSnapshot> => {
      if (!queue) return incoming;

      try {
        const pendingWrites = await queue.getAllQueued(ref.id);
        if (pendingWrites.length === 0) return incoming;

        // Clone incoming snapshot
        const merged: ProjectSnapshot = {
          ...incoming,
          grades: [...incoming.grades],
          comments: [...incoming.comments],
          rankings: [...incoming.rankings],
          outcomes: [...incoming.outcomes],
        };

        for (const write of pendingWrites) {
          if (write.tab === "grades") {
            const [, at, by, optionId, payloadStr] = write.row;
            if (payloadStr) {
              const parsed = JSON.parse(payloadStr);
              // Latest grade per (by, optionId)
              const existingIdx = merged.grades.findIndex(
                (g) => g.by === by && g.optionId === optionId
              );
              const pendingGrade = {
                id: `pending_${write.id ?? Date.now()}`,
                at: at || "",
                by: by || "",
                optionId: optionId || "",
                value: parsed.value,
              };
              if (existingIdx >= 0) {
                merged.grades[existingIdx] = pendingGrade;
              } else {
                merged.grades.push(pendingGrade);
              }
            }
          } else if (write.tab === "comments") {
            const [, at, by, optionId, payloadStr] = write.row;
            if (payloadStr) {
              const parsed = JSON.parse(payloadStr);
              merged.comments.push({
                id: `pending_${write.id ?? Date.now()}`,
                at: at || "",
                by: by || "",
                optionId: optionId || "",
                body: parsed.body,
                hidden: parsed.hidden,
                replaces: parsed.replaces,
              });
            }
          }
        }

        return merged;
      } catch {
        return incoming;
      }
    },
    [queue, ref.id]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const snap = await store.openProject(ref, { password });
      const merged = await mergeWithQueue(snap);
      setSnapshot(merged);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [store, ref, password, mergeWithQueue]);

  useEffect(() => {
    load();

    const unsub = store.watch(ref, async (liveSnap) => {
      const merged = await mergeWithQueue(liveSnap);
      setSnapshot(merged);
    });

    return () => unsub();
  }, [load, store, ref, mergeWithQueue]);

  const appendOptimistic = useCallback(
    async (entries: Entry[]) => {
      await store.append(ref, entries);
      // Re-read local merged state immediately
      if (snapshot) {
        const merged = await mergeWithQueue(snapshot);
        setSnapshot(merged);
      }
    },
    [store, ref, snapshot, mergeWithQueue]
  );

  return {
    snapshot,
    loading,
    error,
    reload: load,
    appendOptimistic,
  };
}
