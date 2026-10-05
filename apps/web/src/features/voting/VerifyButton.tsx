import type { OutcomeRecord } from "@decisionator/core";
import { createRng } from "@decisionator/core";
import type { StrategyPlugin } from "@decisionator/plugin-sdk";
import { bordaStrategy } from "@decisionator/strategy-borda";
import { ownerPickStrategy } from "@decisionator/strategy-owner-pick";
import { randomStrategy } from "@decisionator/strategy-random";
import { weightedStrategy } from "@decisionator/strategy-weighted";
import type React from "react";
import { useState } from "react";

const STRATEGY_REGISTRY: Record<string, StrategyPlugin> = {
  "org.decisionator.strategy.borda": bordaStrategy,
  "org.decisionator.strategy.owner-pick": ownerPickStrategy,
  "org.decisionator.strategy.random": randomStrategy,
  "org.decisionator.strategy.weighted": weightedStrategy,
};

export interface VerifyButtonProps {
  outcome: OutcomeRecord;
}

export const VerifyButton: React.FC<VerifyButtonProps> = ({ outcome }) => {
  const [status, setStatus] = useState<"idle" | "reproduced" | "mismatch" | "unavailable">("idle");

  const handleVerify = () => {
    const plugin = STRATEGY_REGISTRY[outcome.strategy.id];
    if (!plugin) {
      setStatus("unavailable");
      return;
    }

    try {
      const recordedSeed = outcome.seed || "00000000000000000000000000000000";
      const rng = createRng(recordedSeed);

      // Re-run the strategy decide with recorded inputs
      // biome-ignore lint/suspicious/noExplicitAny: reResult may contain extended fields
      const reResult = plugin.decide(outcome.inputs as any, rng) as any;

      const winnerMatched = reResult.chosen[0] === outcome.result.winner;
      const expectedChosen = outcome.result.chosen || [outcome.result.winner];
      const chosenMatched =
        reResult.chosen.length === expectedChosen.length &&
        reResult.chosen.every((id: string, idx: number) => id === expectedChosen[idx]);

      let orderMatched = true;
      if (reResult.order && outcome.result.order) {
        orderMatched =
          reResult.order.length === outcome.result.order.length &&
          reResult.order.every(
            (item: { optionId: string }, idx: number) =>
              item.optionId === outcome.result.order[idx]?.optionId
          );
      }

      if (winnerMatched && chosenMatched && orderMatched) {
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
