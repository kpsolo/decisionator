import type { OutcomeRecord } from "@decisionator/core";
import { createRng } from "@decisionator/core";
import { bordaStrategy } from "@decisionator/strategy-borda";
import type React from "react";
import { useState } from "react";

export interface VerifyButtonProps {
  outcome: OutcomeRecord;
}

export const VerifyButton: React.FC<VerifyButtonProps> = ({ outcome }) => {
  const [status, setStatus] = useState<"idle" | "reproduced" | "mismatch" | "unavailable">("idle");

  const handleVerify = () => {
    // Check if the recorded strategy matches the installed Borda strategy
    if (outcome.strategy.id !== "org.decisionator.strategy.borda") {
      setStatus("unavailable");
      return;
    }

    try {
      const recordedSeed = outcome.seed || "00000000000000000000000000000000";
      const rng = createRng(recordedSeed);

      // Re-run the strategy decide with recorded inputs
      // biome-ignore lint/suspicious/noExplicitAny: Borda extended result returns order and tieBreak
      const reResult = bordaStrategy.decide(outcome.inputs as any, rng) as any;

      const winnerMatched = reResult.chosen[0] === outcome.result.winner;
      const orderMatched =
        reResult.order.length === outcome.result.order.length &&
        reResult.order.every(
          (item: { optionId: string; points: number }, idx: number) =>
            item.optionId === outcome.result.order[idx]?.optionId &&
            item.points === outcome.result.order[idx]?.points
        );

      if (winnerMatched && orderMatched) {
        setStatus("reproduced");
      } else {
        setStatus("mismatch");
      }
    } catch {
      setStatus("mismatch");
    }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={handleVerify}
        className="btn btn-outline"
        style={{ fontSize: 12, padding: "4px 8px" }}
      >
        Verify Outcome
      </button>

      {status === "reproduced" && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-success, #22c55e)",
          }}
        >
          Reproduced ✓
        </span>
      )}

      {status === "mismatch" && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-danger, #ef4444)",
          }}
        >
          Mismatch ✗
        </span>
      )}

      {status === "unavailable" && (
        <span
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          Strategy unavailable
        </span>
      )}
    </div>
  );
};
