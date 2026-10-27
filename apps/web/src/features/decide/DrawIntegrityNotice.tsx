import type { OutcomeRecord } from "@decisionator/core";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { drawIntegrity, drawIntegrityMessages } from "./draw-integrity.js";

/**
 * Says whether the round's outcome in force used a verifiable draw seed and how often the round
 * was re-decided (SECURITY_AUDIT F7). Renders nothing for an undecided round or one with nothing
 * to report.
 */
export function DrawIntegrityNotice({
  outcomes,
  round,
}: {
  outcomes: readonly OutcomeRecord[];
  round: number;
}) {
  const integrity = drawIntegrity(outcomes, round);
  const lines = integrity ? drawIntegrityMessages(integrity) : [];
  if (lines.length === 0) return null;
  return (
    <ul className="m-0 list-none space-y-1 p-0 text-xs" data-testid="draw-integrity">
      {lines.map((l) => (
        <li
          key={l.text}
          className={`flex items-start gap-2 ${l.tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground"}`}
        >
          {l.tone === "warning" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
          )}
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}
