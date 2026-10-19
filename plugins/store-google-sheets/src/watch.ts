import type { ProjectRef, ProjectSnapshot, Unsubscribe } from "@decisionator/plugin-sdk";
import type { QuotaBudget } from "./budget.js";
import type { GoogleApiClient } from "./google-api.js";

export interface WatchProjectOptions {
  client: GoogleApiClient;
  ref: ProjectRef;
  pollIntervalMs?: number; // default 10s
  minBatchGetIntervalMs?: number; // default 15s
  /** Optional quota budget: no full read while it is paused or out of reads. */
  budget?: QuotaBudget;
  onUpdate: () => Promise<ProjectSnapshot>;
  onChange: (snapshot: ProjectSnapshot) => void;
}

function tabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
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
  budget,
  onUpdate,
  onChange,
}: WatchProjectOptions): Unsubscribe {
  let active = true;
  let lastVersion: number | null = null;
  let lastBatchGetTime = 0;
  let polling = false;

  const poll = async () => {
    // Stop when tab is hidden; skip a tick while the previous poll is still running.
    if (!active || polling || tabHidden()) return;
    if (budget?.isPaused()) return;

    polling = true;
    try {
      const file = await client.getFile(ref.id, "version");
      const currentVersion = file.version ? Number.parseInt(file.version, 10) : null;

      if (currentVersion !== null && lastVersion !== null && currentVersion !== lastVersion) {
        const now = Date.now();
        if (now - lastBatchGetTime >= minBatchGetIntervalMs && (budget?.canRead(now) ?? true)) {
          lastBatchGetTime = now;
          budget?.recordRead(now);
          const freshSnapshot = await onUpdate();
          lastVersion = currentVersion;
          if (active) onChange(freshSnapshot);
        }
      } else if (lastVersion === null && currentVersion !== null) {
        lastVersion = currentVersion;
      }
    } catch {
      // Background poll silently retries next interval
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(poll, pollIntervalMs);
  // Take the baseline version now, so a change in the first interval is not missed.
  void poll();

  return () => {
    active = false;
    clearInterval(timer);
  };
}
