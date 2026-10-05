import { runTally } from "@decisionator/core";
import type { Option, OutcomeRecord, Project } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { GoogleAuthService, GoogleSheetsProjectStore } from "@decisionator/store-google-sheets";
import { bordaStrategy } from "@decisionator/strategy-borda";
import { ownerPickStrategy } from "@decisionator/strategy-owner-pick";
import { randomStrategy } from "@decisionator/strategy-random";
import { weightedStrategy } from "@decisionator/strategy-weighted";
import type React from "react";
import { useState } from "react";
import { getGoogleConfig } from "../../config/google.js";

export interface StrategyDescriptor {
  id: string;
  name: string;
  version: string;
  description: string;
  usesRandomness: boolean;
  interactive?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: strategy plugin interface
  strategy: any;
}

export const BUILTIN_STRATEGIES: StrategyDescriptor[] = [
  {
    id: "org.decisionator.strategy.borda",
    name: "Borda Count Ranking",
    version: "0.1.0",
    description: "Points-based ranking over contributor ballots with deterministic tie-breaking.",
    usesRandomness: true,
    strategy: bordaStrategy,
  },
  {
    id: "org.decisionator.strategy.owner-pick",
    name: "Owner Direct Pick",
    version: "0.1.0",
    description: "The owner directly designates the winning option.",
    usesRandomness: false,
    interactive: true,
    strategy: ownerPickStrategy,
  },
  {
    id: "org.decisionator.strategy.random",
    name: "Uniform Random Draw",
    version: "0.1.0",
    description: "Fair, unweighted random selection with reproducible CSPRNG seed.",
    usesRandomness: true,
    strategy: randomStrategy,
  },
  {
    id: "org.decisionator.strategy.weighted",
    name: "Random Weighted by Grades",
    version: "0.1.0",
    description: "Draws an option with probability proportional to its average grade.",
    usesRandomness: true,
    strategy: weightedStrategy,
  },
];

export interface StrategyChooserProps {
  snapshot: ProjectSnapshot;
  fileId: string;
  currentUser: string;
  isOwner: boolean;
  onOutcomeCreated?: (outcome: OutcomeRecord) => void;
}

export const StrategyChooser: React.FC<StrategyChooserProps> = ({
  snapshot,
  fileId,
  currentUser,
  isOwner,
  onOutcomeCreated,
}) => {
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(
    "org.decisionator.strategy.random"
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string>(snapshot.options[0]?.id || "");
  const [includeUngraded, setIncludeUngraded] = useState<boolean>(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const activeOptions = snapshot.options.filter((o) => o.status === "active");
  const selectedDescriptor = BUILTIN_STRATEGIES.find((s) => s.id === selectedStrategyId);

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
      const cfg = getGoogleConfig();
      const auth = new GoogleAuthService({ clientId: cfg.clientId });
      const store = new GoogleSheetsProjectStore(auth);

      await store.append({ store: "google-sheets", id: fileId }, [
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
      <div className="card">
        <h3>Decision Strategies</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Only the project owner can execute decision strategies or close voting.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ margin: "0 0 6px 0" }}>Choose Decision Strategy</h3>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
          Decide between candidates using owner pick, uniform random, grade-weighted draw, or ranked
          voting.
        </p>
      </div>

      {/* Strategy selector radio group */}
      <fieldset
        style={{
          border: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
          Available Strategies
        </legend>
        {BUILTIN_STRATEGIES.map((desc) => {
          const preCheck = checkPreconditions(desc);
          const isSelected = selectedStrategyId === desc.id;

          return (
            <label
              key={desc.id}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "10px 12px",
                borderRadius: 6,
                border: isSelected
                  ? "2px solid var(--primary, #3b82f6)"
                  : "1px solid var(--border)",
                backgroundColor: isSelected ? "var(--bg-accent, #eff6ff)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="decisionStrategy"
                  value={desc.id}
                  checked={isSelected}
                  onChange={() => {
                    setSelectedStrategyId(desc.id);
                    setErrorMsg(null);
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{desc.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>v{desc.version}</span>
                {desc.usesRandomness && (
                  <span
                    style={{
                      fontSize: 11,
                      backgroundColor: "var(--badge-bg, #e2e8f0)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    🎲 Seeded RNG
                  </span>
                )}
              </div>
              <p style={{ margin: "4px 0 0 24px", fontSize: 13, color: "var(--text-muted)" }}>
                {desc.description}
              </p>
              {!preCheck.ok && (
                <div
                  style={{
                    margin: "4px 0 0 24px",
                    fontSize: 12,
                    color: "var(--color-danger, #ef4444)",
                    fontWeight: 500,
                  }}
                >
                  ⚠️ Precondition unmet: {preCheck.reason}
                </div>
              )}
            </label>
          );
        })}
      </fieldset>

      {/* Custom parameters for interactive or configurable strategies */}
      {selectedDescriptor?.interactive && (
        <div style={{ padding: 12, backgroundColor: "var(--bg-subtle, #f8fafc)", borderRadius: 6 }}>
          <label
            htmlFor="owner-pick-select"
            style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 6 }}
          >
            Select Option to Pick:
          </label>
          <select
            id="owner-pick-select"
            value={selectedOptionId}
            onChange={(e) => setSelectedOptionId(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
            }}
          >
            {activeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedDescriptor?.id === "org.decisionator.strategy.weighted" && (
        <div style={{ padding: 12, backgroundColor: "var(--bg-subtle, #f8fafc)", borderRadius: 6 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={includeUngraded}
              onChange={(e) => setIncludeUngraded(e.target.checked)}
            />
            <span>Include ungraded options (give them minimum baseline weight of 1.0)</span>
          </label>
        </div>
      )}

      {errorMsg && (
        <output
          aria-live="polite"
          style={{
            padding: 8,
            borderRadius: 4,
            backgroundColor: "#fee2e2",
            color: "#b91c1c",
            fontSize: 13,
            display: "block",
          }}
        >
          {errorMsg}
        </output>
      )}

      {successMsg && (
        <output
          aria-live="polite"
          style={{
            padding: 8,
            borderRadius: 4,
            backgroundColor: "#dcfce7",
            color: "#15803d",
            fontSize: 13,
            display: "block",
          }}
        >
          {successMsg}
        </output>
      )}

      <div>
        <button
          type="button"
          onClick={handleRunStrategy}
          disabled={
            running || (selectedDescriptor ? !checkPreconditions(selectedDescriptor).ok : true)
          }
          className="btn btn-primary"
          style={{ padding: "8px 16px" }}
        >
          {running
            ? "Executing Decision..."
            : `Decide with ${selectedDescriptor?.name || "Strategy"}`}
        </button>
      </div>
    </div>
  );
};
