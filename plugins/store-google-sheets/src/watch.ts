import type { ProjectRef, ProjectSnapshot, Unsubscribe } from "@decisionator/plugin-sdk";
import type { GoogleApiClient } from "./google-api.js";

export interface WatchProjectOptions {
  client: GoogleApiClient;
  ref: ProjectRef;
  pollIntervalMs?: number; // default 10s
  minBatchGetIntervalMs?: number; // default 15s
  onUpdate: () => Promise<ProjectSnapshot>;
  onChange: (snapshot: ProjectSnapshot) => void;
}

/**
 * Polls Drive files.get?fields=version every 10s while tab is visible.
 * Triggers batchGet via onUpdate at most every 15s when version changes.
 */
export function watchProjectChanges({
  client,
  ref,
  pollIntervalMs = 10_000,
  minBatchGetIntervalMs = 15_000,
  onUpdate,
  onChange,
}: WatchProjectOptions): Unsubscribe {
  let active = true;
  let lastVersion: number | null = null;
  let lastBatchGetTime = 0;

  const poll = async () => {
    if (!active) return;

    // Stop when tab is hidden
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    try {
      const file = await client.getFile(ref.id);
      const currentVersion = file.version ? Number.parseInt(file.version, 10) : null;

      if (currentVersion !== null && lastVersion !== null && currentVersion !== lastVersion) {
        const now = Date.now();
        if (now - lastBatchGetTime >= minBatchGetIntervalMs) {
          lastBatchGetTime = now;
          lastVersion = currentVersion;
          const freshSnapshot = await onUpdate();
          onChange(freshSnapshot);
        }
      } else if (lastVersion === null && currentVersion !== null) {
        lastVersion = currentVersion;
      }
    } catch {
      // Background poll silently retries next interval
    }
  };

  const timer = setInterval(poll, pollIntervalMs);

  return () => {
    active = false;
    clearInterval(timer);
  };
}
