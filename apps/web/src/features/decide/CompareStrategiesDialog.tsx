import type { OutcomeRecord } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { Loader2, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { getInstalledPlugins } from "../plugins/plugin-registry.js";
import { type ComparisonRow, compareStrategies } from "./compare.js";
import { chosenStrategy, enabledStrategies } from "./strategies.js";

/**
 * Side-by-side preview of what every enabled strategy would decide from the same votes (FR-038).
 * Nothing is recorded unless the owner adopts a row (FR-039).
 */
export function CompareStrategiesDialog({
  snapshot,
  canAdopt,
  triggeredBy,
  onAdopt,
}: {
  snapshot: ProjectSnapshot;
  canAdopt: boolean;
  triggeredBy: string;
  onAdopt?(outcome: OutcomeRecord): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const titleOf = (id: string) => snapshot.options.find((o) => o.id === id)?.title ?? id;
  const chosen = chosenStrategy(snapshot);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(null);
    setMessage(null);
    compareStrategies(snapshot, enabledStrategies(getInstalledPlugins()), triggeredBy).then(
      (r) => !cancelled && setRows(r),
      (err) => !cancelled && setMessage(err instanceof Error ? err.message : String(err))
    );
    return () => {
      cancelled = true;
    };
  }, [open, snapshot, triggeredBy]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        leftIcon={<Scale className="h-4 w-4" />}
        onClick={() => setOpen(true)}
      >
        Compare strategies
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogTitle>Compare strategies</DialogTitle>
          <DialogDescription>
            {`What each method would decide from the same votes. This project is decided by ${chosen.name}. Nothing is recorded unless you adopt a result.`}
          </DialogDescription>

          {!rows && !message && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              Comparing…
            </p>
          )}
          {rows && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Strategy comparison</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Strategy
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Winner
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Top 3
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Seed / reason
                    </th>
                    {canAdopt && (
                      <th scope="col" className="py-2 font-medium">
                        <span className="sr-only">Adopt</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.strategyId}
                      className={`border-b border-border/60 align-top ${r.differsFromChosen ? "bg-warning/10" : ""}`}
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {r.name}
                        {r.strategyId === chosen.id && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            Chosen
                          </Badge>
                        )}
                      </th>
                      <td className="py-2 pr-3">
                        {r.ok ? (
                          <>
                            <span className="font-medium">{titleOf(r.winner)}</span>
                            {r.differsFromChosen && (
                              <span className="block text-xs text-warning-foreground dark:text-warning">
                                Winner differs from the chosen method
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {r.ok ? r.order.slice(0, 3).map(titleOf).join(", ") : "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {r.ok ? (
                          (r.seed ?? "No randomness")
                        ) : (
                          <span className="font-sans">{r.reason}</span>
                        )}
                      </td>
                      {canAdopt && (
                        <td className="py-2">
                          {r.ok && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={adopting !== null}
                              aria-label={`Adopt the ${r.name} result`}
                              onClick={async () => {
                                if (!onAdopt) return;
                                setAdopting(r.strategyId);
                                try {
                                  await onAdopt(r.outcome);
                                  setMessage(`Adopted the ${r.name} result as a new outcome.`);
                                } catch (err) {
                                  setMessage(err instanceof Error ? err.message : String(err));
                                } finally {
                                  setAdopting(null);
                                }
                              }}
                            >
                              Adopt
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {message && (
            <output aria-live="polite" className="block text-sm text-muted-foreground">
              {message}
            </output>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
