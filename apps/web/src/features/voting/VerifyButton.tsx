import type { OutcomeRecord } from "@decisionator/core";
import { createRng } from "@decisionator/core";
import type { StrategyPlugin } from "@decisionator/plugin-sdk";
import { bordaStrategy } from "@decisionator/strategy-borda";
import { ownerPickStrategy } from "@decisionator/strategy-owner-pick";
import { randomStrategy } from "@decisionator/strategy-random";
import { weightedStrategy } from "@decisionator/strategy-weighted";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";

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
    <div className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleVerify}
        leftIcon={<ShieldCheck className="h-3.5 w-3.5" />}
      >
        Verify Outcome
      </Button>

      <output className="inline-flex items-center text-xs">
        {status === "reproduced" && (
          <span className="inline-flex items-center gap-1 font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Reproduced ✓
          </span>
        )}

        {status === "mismatch" && (
          <span className="inline-flex items-center gap-1 font-semibold text-destructive">
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            Mismatch ✗
          </span>
        )}

        {status === "unavailable" && (
          <span className="text-muted-foreground">Strategy unavailable</span>
        )}
      </output>
    </div>
  );
};
