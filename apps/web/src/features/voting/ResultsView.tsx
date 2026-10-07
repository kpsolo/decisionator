import { type Option, type OutcomeRecord, type Ranking, latestOutcome } from "@decisionator/core";
import { Award, History, Trophy } from "lucide-react";
import type React from "react";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardHeader } from "../../components/ui/card.js";
import { strategyName } from "../decide/StrategyChooser.js";
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
  // Re-deciding with another strategy appends an outcome; the newest one is in force.
  const current = latestOutcome(outcomes, currentRound);

  if (isOpen && !liveResults) {
    const roundBallotCount = rankings.filter((r) => (r.round ?? 1) === currentRound).length;
    return (
      <Card className="max-w-xl mx-auto border-border bg-card text-center py-12 shadow-xs">
        <CardContent className="space-y-3">
          <h3 className="text-lg font-bold">Voting in Progress</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Live results are disabled for this round. {roundBallotCount}{" "}
            {roundBallotCount === 1 ? "ballot has" : "ballots have"} been submitted. Results will be
            revealed when voting is closed by the owner.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!current) {
    return (
      <Card className="max-w-xl mx-auto border-border bg-card text-center py-12 shadow-xs">
        <CardContent className="space-y-3">
          <h3 className="text-lg font-bold">No Outcomes Recorded Yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Once voting is closed, the deterministic tally will record an outcome here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const winnerOption = optionMap.get(current.result.winner);

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Winner Hero Card */}
      <Card className="border-rating/40 bg-gradient-to-br from-rating/10 via-card to-success/10 shadow-sm">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-foreground font-bold text-xs uppercase tracking-wider">
                <Trophy className="h-4 w-4 text-rating" aria-hidden="true" />
                <span>{`Round ${current.round ?? 1} Winner`}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {winnerOption?.title || current.result.winner}
              </h2>
              {winnerOption?.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {winnerOption.description}
                </p>
              )}
            </div>

            <VerifyButton outcome={current} />
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border/80 pt-3 flex-wrap">
            <span>
              Ranked by:{" "}
              <strong className="font-medium text-foreground">
                {strategyName(current.strategy.id)}
              </strong>
            </span>
            <span>
              Tie-Break Used:{" "}
              <strong className="font-medium text-foreground">{current.tieBreak}</strong>
            </span>
            <span>
              Decided:{" "}
              <strong className="font-medium text-foreground">
                {new Date(current.at).toLocaleDateString()}
              </strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Full Order & Points Card */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader>
          <h4 className="text-base font-semibold leading-none tracking-tight flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>Final Ranked Order & Points</span>
          </h4>
        </CardHeader>
        <CardContent className="space-y-2">
          {current.result.order.map((item, idx) => {
            const opt = optionMap.get(item.optionId);
            return (
              <div
                key={item.optionId}
                className={`flex items-center justify-between p-3 rounded-lg border text-sm transition-colors ${
                  idx === 0
                    ? "border-rating/40 bg-rating/10 font-semibold"
                    : "border-border bg-card/60"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                      idx === 0
                        ? "bg-primary-solid text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <span className="truncate text-foreground">{opt?.title || item.optionId}</span>
                </div>

                {/* Ranked (Borda) outcomes carry points; draws and owner picks list order only. */}
                {(item.firstPlaces !== undefined || item.points !== undefined) && (
                  <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 pl-2">
                    {item.firstPlaces !== undefined && <span>{item.firstPlaces} 1st places</span>}
                    {item.points !== undefined && (
                      <Badge variant="secondary" className="font-bold text-xs">
                        {item.points} pts
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* History of Rounds */}
      {outcomes.length > 1 && (
        <Card className="border-border bg-card shadow-xs">
          <CardHeader>
            <h4 className="text-sm font-semibold leading-none tracking-tight flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>{`Decision History (${outcomes.length} outcomes)`}</span>
            </h4>
          </CardHeader>
          <CardContent className="space-y-2">
            {outcomes.map((out) => (
              <div
                key={out.id || out.at}
                className="flex items-center justify-between p-2.5 rounded-md border border-border text-xs bg-muted/20"
              >
                <span className="text-foreground">
                  Round {out.round ?? 1}: Winner{" "}
                  <strong>{optionMap.get(out.result.winner)?.title || out.result.winner}</strong>
                  <span className="text-muted-foreground"> · {strategyName(out.strategy.id)}</span>
                </span>
                <span className="text-muted-foreground">
                  {new Date(out.at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ResultsView;
