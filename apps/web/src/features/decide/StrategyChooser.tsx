import { latestOutcome, runTally } from "@decisionator/core";
import type { Option, OutcomeRecord, Project } from "@decisionator/core";
import type { ProjectRef, ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import { CheckCircle2, Play, Sparkles } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { getInstalledPlugins } from "../plugins/plugin-registry.js";
import { DrawIntegrityNotice } from "./DrawIntegrityNotice.js";
import { type StrategyDescriptor, enabledStrategies } from "./strategies.js";

export { BUILTIN_STRATEGIES, strategyName } from "./strategies.js";
export type { StrategyDescriptor } from "./strategies.js";

const DEFAULT_STRATEGY_ID = "org.decisionator.strategy.random";

/**
 * The strategy selected at first: the one in force (the latest outcome's) when it is available,
 * else the default, else the first available one. Disabled strategies are never selected.
 */
export function initialStrategyId(
  available: Pick<StrategyDescriptor, "id">[],
  currentId: string | undefined
): string {
  const has = (id: string | undefined) => !!id && available.some((s) => s.id === id);
  if (has(currentId)) return currentId as string;
  if (has(DEFAULT_STRATEGY_ID)) return DEFAULT_STRATEGY_ID;
  return available[0]?.id ?? "";
}

export interface StrategyChooserProps {
  snapshot: ProjectSnapshot;
  /** Store and project the outcome is recorded in (whatever backend holds the project). */
  store: ProjectStore;
  projectRef: ProjectRef;
  currentUser: string;
  isOwner: boolean;
  onOutcomeCreated?: (outcome: OutcomeRecord) => void;
}

export const StrategyChooser: React.FC<StrategyChooserProps> = ({
  snapshot,
  store,
  projectRef,
  currentUser,
  isOwner,
  onOutcomeCreated,
}) => {
  // Only strategies whose plugin is enabled can be chosen or run.
  const available = useMemo(() => enabledStrategies(getInstalledPlugins()), []);
  // Start from the ranking system currently in force (the latest outcome's), if available.
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(() =>
    initialStrategyId(
      available,
      latestOutcome(snapshot.outcomes, snapshot.project.voting?.round)?.strategy.id
    )
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string>(snapshot.options[0]?.id || "");
  const [includeUngraded, setIncludeUngraded] = useState<boolean>(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const activeOptions = snapshot.options.filter((o) => o.status === "active");
  const round = snapshot.project.voting?.round ?? 1;
  const selectedDescriptor = available.find((s) => s.id === selectedStrategyId);

  // Check preconditions in real-time
  const checkPreconditions = (desc: StrategyDescriptor): { ok: boolean; reason?: string } => {
    const input = {
      options: activeOptions.map((o) => ({ id: o.id, title: o.title })),
      ballots: snapshot.rankings.map((r) => ({ by: r.by, ranking: r.ranking })),
      grades: snapshot.grades.map((g) => ({
        optionId: g.optionId,
        average: g.value,
        count: 1,
      })),
      settings:
        desc.id === "org.decisionator.strategy.weighted"
          ? { includeUngraded }
          : desc.id === "org.decisionator.strategy.borda"
            ? { topN: snapshot.project.voting?.topN ?? 3 }
            : {},
      runInput: desc.interactive ? selectedOptionId : undefined,
    };

    return desc.strategy.check(input);
  };

  const handleRunStrategy = async () => {
    if (!isOwner || !selectedDescriptor) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const check = checkPreconditions(selectedDescriptor);
    if (!check.ok) {
      setErrorMsg(check.reason || "Preconditions not met");
      return;
    }

    try {
      setRunning(true);
      const outcome = await runTally({
        snapshot,
        strategy: selectedDescriptor.strategy,
        strategyId: selectedDescriptor.id,
        strategyVersion: selectedDescriptor.version,
        triggeredBy: currentUser,
        settings:
          selectedDescriptor.id === "org.decisionator.strategy.weighted"
            ? { includeUngraded }
            : selectedDescriptor.id === "org.decisionator.strategy.borda"
              ? { topN: snapshot.project.voting?.topN ?? 3 }
              : {},
        runInput: selectedDescriptor.interactive ? selectedOptionId : undefined,
        usesRandomness: selectedDescriptor.usesRandomness,
      });

      // Append outcome to project store
      await store.append(projectRef, [
        {
          kind: "outcome",
          outcome,
        },
      ]);

      setSuccessMsg(
        `Decision executed: Winner is "${snapshot.options.find((o) => o.id === outcome.result.winner)?.title || outcome.result.winner}"`
      );
      if (onOutcomeCreated) {
        onOutcomeCreated(outcome);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!isOwner) {
    return (
      <Card className="max-w-xl mx-auto border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-bold">Decision Strategies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Only the project owner can execute decision strategies or close voting.</p>
          <DrawIntegrityNotice outcomes={snapshot.outcomes} round={round} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl mx-auto border-border bg-card shadow-xs">
      <CardHeader>
        <div className="flex items-center gap-2 text-primary font-medium text-xs tracking-wider uppercase mb-1">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          <span>Pluggable Strategies</span>
        </div>
        <CardTitle className="text-lg font-bold">Choose Decision Strategy</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Decide between candidates using owner pick, uniform random, grade-weighted draw, or ranked
          voting.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <DrawIntegrityNotice outcomes={snapshot.outcomes} round={round} />
        {/* Strategy selector radio group */}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-foreground">
            Available Strategies
          </legend>
          {available.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No decision strategy is enabled. Enable one on the Plugins page.
            </p>
          )}
          {available.map((desc) => {
            const preCheck = checkPreconditions(desc);
            const isSelected = selectedStrategyId === desc.id;

            return (
              <label
                key={desc.id}
                className={`flex flex-col p-3 rounded-lg border transition-colors cursor-pointer select-none ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-2xs"
                    : "border-border bg-card/60 hover:bg-accent/40"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="decisionStrategy"
                    value={desc.id}
                    checked={isSelected}
                    onChange={() => {
                      setSelectedStrategyId(desc.id);
                      setErrorMsg(null);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  <div className="flex items-center gap-2 flex-wrap flex-1">
                    <span className="font-semibold text-sm text-foreground">{desc.name}</span>
                    <Badge variant="outline" className="text-[10px] py-0">
                      v{desc.version}
                    </Badge>
                    {desc.usesRandomness && (
                      <Badge variant="secondary" className="text-[10px] py-0">
                        🎲 Seeded RNG
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground ml-7 mt-1 leading-relaxed">
                  {desc.description}
                </p>

                {!preCheck.ok && (
                  <p className="text-xs text-destructive ml-7 mt-1 font-medium">
                    ⚠️ Precondition unmet: {preCheck.reason}
                  </p>
                )}
              </label>
            );
          })}
        </fieldset>

        {/* Custom parameters for interactive or configurable strategies */}
        {selectedDescriptor?.interactive && (
          <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2">
            <label
              htmlFor="owner-pick-select"
              className="block text-xs font-semibold text-foreground"
            >
              Select Option to Pick:
            </label>
            <NativeSelect
              id="owner-pick-select"
              value={selectedOptionId}
              onChange={(e) => setSelectedOptionId(e.target.value)}
              wrapperClassName="w-full"
            >
              {activeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        {selectedDescriptor?.id === "org.decisionator.strategy.weighted" && (
          <div className="rounded-lg border border-border bg-muted/20 p-3.5">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none font-medium text-foreground">
              <input
                type="checkbox"
                checked={includeUngraded}
                onChange={(e) => setIncludeUngraded(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>Include ungraded options (give them minimum baseline weight of 1.0)</span>
            </label>
          </div>
        )}

        {errorMsg && (
          <output
            aria-live="polite"
            className="block rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive font-medium"
          >
            {errorMsg}
          </output>
        )}

        {successMsg && (
          <output
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success font-medium"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            <span>{successMsg}</span>
          </output>
        )}
      </CardContent>

      <CardFooter className="border-t border-border pt-4 flex justify-end">
        <Button
          type="button"
          variant="default"
          onClick={handleRunStrategy}
          disabled={
            running || (selectedDescriptor ? !checkPreconditions(selectedDescriptor).ok : true)
          }
          leftIcon={<Play className="h-4 w-4" aria-hidden />}
        >
          {running
            ? "Executing Decision..."
            : `Decide with ${selectedDescriptor?.name || "Strategy"}`}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default StrategyChooser;
