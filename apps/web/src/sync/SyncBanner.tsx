import type { QuotaBudget, WriteQueue } from "@decisionator/store-google-sheets";
import type React from "react";
import { useEffect, useState } from "react";

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
      style={{
        width: "100%",
        padding: "8px 16px",
        background: isPaused ? "rgba(234, 179, 8, 0.15)" : "rgba(59, 130, 246, 0.15)",
        borderBottom: `1px solid ${isPaused ? "rgba(234, 179, 8, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
        color: isPaused ? "var(--color-warning, #eab308)" : "var(--color-info, #60a5fa)",
        fontSize: 13,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{isPaused ? "⏳" : "🔄"}</span>
        <span>
          {isPaused
            ? `Syncing paused due to rate limits. Retrying in ${retryCountdown} s...`
            : "Syncing changes to Google Sheets..."}
        </span>
      </div>

      {queuedCount > 0 && (
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.2)",
            border: "1px solid var(--border)",
          }}
        >
          {queuedCount} {queuedCount === 1 ? "write" : "writes"} queued
        </span>
      )}
    </output>
  );
};
