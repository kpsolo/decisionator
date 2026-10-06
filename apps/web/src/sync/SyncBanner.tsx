import type { QuotaBudget, WriteQueue } from "@decisionator/store-google-sheets";
import { Clock, RefreshCw } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge.js";

export interface SyncBannerProps {
  budget?: QuotaBudget;
  queue?: WriteQueue;
  spreadsheetId?: string;
}

export const SyncBanner: React.FC<SyncBannerProps> = ({ budget, queue, spreadsheetId }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    if (!budget && !queue) return;

    const checkState = () => {
      const now = Date.now();
      const pausedUntil = budget?.getPausedUntil() ?? 0;
      const paused = pausedUntil > now;
      setIsPaused(paused);

      if (paused) {
        const remainingSeconds = Math.max(0, Math.ceil((pausedUntil - now) / 1000));
        setRetryCountdown(remainingSeconds);
      } else {
        setRetryCountdown(0);
      }
    };

    checkState();
    const unsub = budget?.on("pausedUntil", () => {
      checkState();
    });

    const interval = setInterval(async () => {
      checkState();

      if (queue) {
        try {
          const count = await queue.getQueuedCount(spreadsheetId);
          setQueuedCount(count);
        } catch {
          // ignore background count error
        }
      }
    }, 1000);

    return () => {
      unsub?.();
      clearInterval(interval);
    };
  }, [budget, queue, spreadsheetId]);

  if (!isPaused && queuedCount === 0) {
    return null;
  }

  return (
    <output
      aria-live="polite"
      className={`w-full px-4 py-2 text-xs flex justify-between items-center transition-colors border-b ${
        isPaused
          ? "bg-warning/15 border-warning/30 text-warning"
          : "bg-primary/10 border-primary/20 text-primary"
      }`}
    >
      <div className="flex items-center gap-2">
        {isPaused ? (
          <Clock
            className="h-4 w-4 shrink-0 animate-pulse motion-reduce:animate-none text-warning"
            aria-hidden="true"
          />
        ) : (
          <RefreshCw
            className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none text-primary"
            aria-hidden="true"
          />
        )}
        <span className="font-medium text-foreground">
          {isPaused
            ? `Syncing paused due to rate limits. Retrying in ${retryCountdown} s...`
            : "Syncing changes to Google Sheets..."}
        </span>
      </div>

      {queuedCount > 0 && (
        <Badge variant={isPaused ? "warning" : "secondary"} className="text-[11px] font-mono">
          {queuedCount} {queuedCount === 1 ? "write" : "writes"} queued
        </Badge>
      )}
    </output>
  );
};
