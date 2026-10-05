import type { Option, OutcomeRecord, Ranking } from "@decisionator/core";
import type React from "react";
import { VerifyButton } from "./VerifyButton.js";

export interface ResultsViewProps {
  outcomes: OutcomeRecord[];
  options: Option[];
  rankings: Ranking[];
  currentRound: number;
  liveResults: boolean;
  isOpen: boolean;
}

export const ResultsView: React.FC<ResultsViewProps> = ({
  outcomes,
  options,
  rankings,
  currentRound,
  liveResults,
  isOpen,
}) => {
  const optionMap = new Map(options.map((o) => [o.id, o]));
  const latestOutcome =
    outcomes.find((o) => (o.round ?? 1) === currentRound) || outcomes[outcomes.length - 1];

  // If voting is open and live results is off
  if (isOpen && !liveResults) {
    const roundBallotCount = rankings.filter((r) => (r.round ?? 1) === currentRound).length;
    return (
      <div
        className="card"
        style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", padding: 32 }}
      >
        <h3 style={{ marginBottom: 8 }}>Voting in Progress</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Live results are disabled for this round. {roundBallotCount}{" "}
          {roundBallotCount === 1 ? "ballot has" : "ballots have"} been submitted. Results will be
          revealed when voting is closed by the owner.
        </p>
      </div>
    );
  }

  if (!latestOutcome) {
    return (
      <div
        className="card"
        style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", padding: 32 }}
      >
        <h3 style={{ marginBottom: 8 }}>No Outcomes Recorded Yet</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Once voting is closed, the deterministic tally will record an outcome here.
        </p>
      </div>
    );
  }

  const winnerOption = optionMap.get(latestOutcome.result.winner);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640, margin: "0 auto" }}
    >
      {/* Winner Card */}
      <div
        className="card"
        style={{
          background:
            "linear-gradient(135deg, rgba(234, 179, 8, 0.1) 0%, rgba(34, 197, 94, 0.1) 100%)",
          border: "1px solid rgba(234, 179, 8, 0.4)",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "var(--color-warning, #eab308)",
              }}
            >
              ★ Round {latestOutcome.round ?? 1} Winner ★
            </span>
            <h2 style={{ margin: "6px 0 8px 0" }}>
              {winnerOption?.title || latestOutcome.result.winner}
            </h2>
            {winnerOption?.description && (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
                {winnerOption.description}
              </p>
            )}
          </div>
          <VerifyButton outcome={latestOutcome} />
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 13,
            color: "var(--text-muted)",
            display: "flex",
            gap: 16,
          }}
        >
          <span>
            Tie-Break Used: <strong>{latestOutcome.tieBreak}</strong>
          </span>
          <span>
            Decided: <strong>{new Date(latestOutcome.at).toLocaleDateString()}</strong>
          </span>
        </div>
      </div>

      {/* Full Order & Points Card */}
      <div className="card">
        <h4 style={{ margin: "0 0 16px 0" }}>Final Ranked Order & Points</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {latestOutcome.result.order.map((item, idx) => {
            const opt = optionMap.get(item.optionId);
            return (
              <div
                key={item.optionId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: idx === 0 ? "rgba(234, 179, 8, 0.1)" : "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, width: 24 }}>#{idx + 1}</span>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>
                    {opt?.title || item.optionId}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-muted)" }}>
                  <span>{item.firstPlaces} 1st places</span>
                  <strong>{item.points} pts</strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History of Rounds */}
      {outcomes.length > 1 && (
        <div className="card">
          <h4 style={{ margin: "0 0 12px 0" }}>Round History ({outcomes.length} rounds)</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {outcomes.map((out) => (
              <div
                key={out.id || out.at}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <span>
                  Round {out.round ?? 1}: Winner{" "}
                  <strong>{optionMap.get(out.result.winner)?.title || out.result.winner}</strong>
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {new Date(out.at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
