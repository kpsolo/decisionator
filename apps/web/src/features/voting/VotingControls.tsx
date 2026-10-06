import type { Project } from "@decisionator/core";
import { Lock, Play } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";

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
        await onCloseAndTally();
      } else {
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
    <Card className="max-w-xl mx-auto mb-5 border-border bg-card shadow-xs">
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h4 className="font-semibold text-sm text-foreground">
              {`Voting Controls — Round ${currentVoting.round ?? 1}`}
            </h4>
            <div className="flex items-center gap-2">
              <Badge variant={isOpen ? "success" : "destructive"} className="text-xs font-semibold">
                {isOpen ? "● Voting is OPEN" : "● Voting is CLOSED"}
              </Badge>
            </div>
          </div>

          <Button
            type="button"
            variant={isOpen ? "destructive" : "default"}
            size="sm"
            onClick={handleToggleState}
            isLoading={loading}
            leftIcon={
              isOpen ? (
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
          >
            {loading
              ? "Updating..."
              : isOpen
                ? "Close Voting & Tally Results"
                : `Open Round ${(currentVoting.round ?? 1) + 1}`}
          </Button>
        </div>

        {isOpen && (
          <div className="border-t border-border pt-3.5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <label htmlFor="top-n-select" className="font-medium text-foreground">
                Top N:
              </label>
              <select
                id="top-n-select"
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground select-none">
              <input
                type="checkbox"
                checked={liveResults}
                onChange={(e) => setLiveResults(e.target.checked)}
                className="rounded border-input text-primary focus:ring-ring h-4 w-4"
              />
              <span>Show live rankings during voting</span>
            </label>

            {(topN !== currentVoting.topN || liveResults !== currentVoting.liveResults) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveSettings}
                isLoading={loading}
                className="ml-auto h-7 text-xs"
              >
                Apply Settings
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VotingControls;
