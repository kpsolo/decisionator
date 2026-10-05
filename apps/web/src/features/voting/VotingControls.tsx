import type { Project } from "@decisionator/core";
import type React from "react";
import { useState } from "react";

export interface VotingControlsProps {
  voting?: Project["voting"];
  onUpdateVoting: (voting: NonNullable<Project["voting"]>) => Promise<void>;
  onCloseAndTally: () => Promise<void>;
}

export const VotingControls: React.FC<VotingControlsProps> = ({
  voting,
  onUpdateVoting,
  onCloseAndTally,
}) => {
  const currentVoting = voting ?? {
    state: "open",
    round: 1,
    topN: 3,
    liveResults: true,
  };

  const [topN, setTopN] = useState(currentVoting.topN ?? 3);
  const [liveResults, setLiveResults] = useState(currentVoting.liveResults ?? true);
  const [loading, setLoading] = useState(false);

  const isOpen = currentVoting.state === "open";

  const handleToggleState = async () => {
    try {
      setLoading(true);
      if (isOpen) {
        // Close voting and run tally
        await onCloseAndTally();
      } else {
        // Reopen next round
        await onUpdateVoting({
          state: "open",
          round: (currentVoting.round ?? 1) + 1,
          topN,
          liveResults,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setLoading(true);
      await onUpdateVoting({
        ...currentVoting,
        topN,
        liveResults,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 640, margin: "0 auto 20px auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h4 style={{ margin: "0 0 4px 0" }}>
            Voting Controls — Round {currentVoting.round ?? 1}
          </h4>
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 600,
              background: isOpen ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: isOpen ? "var(--color-success, #22c55e)" : "var(--color-danger, #ef4444)",
            }}
          >
            ● {isOpen ? "Voting is OPEN" : "Voting is CLOSED"}
          </span>
        </div>

        <button
          type="button"
          onClick={handleToggleState}
          disabled={loading}
          className={`btn ${isOpen ? "btn-danger" : "btn-primary"}`}
          style={{ fontSize: 13 }}
        >
          {loading
            ? "Updating..."
            : isOpen
              ? "Close Voting & Tally Results"
              : `Open Round ${(currentVoting.round ?? 1) + 1}`}
        </button>
      </div>

      {isOpen && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
            display: "flex",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="top-n-select" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Top N:
            </label>
            <select
              id="top-n-select"
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: 13,
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={liveResults}
              onChange={(e) => setLiveResults(e.target.checked)}
            />
            Show live rankings during voting
          </label>

          {(topN !== currentVoting.topN || liveResults !== currentVoting.liveResults) && (
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={loading}
              className="btn btn-outline"
              style={{ fontSize: 12, padding: "2px 8px", marginLeft: "auto" }}
            >
              Apply Settings
            </button>
          )}
        </div>
      )}
    </div>
  );
};
