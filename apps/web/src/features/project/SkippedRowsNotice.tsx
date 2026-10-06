import { AlertTriangle } from "lucide-react";

export interface SkippedRowsNoticeProps {
  /** `ProjectSnapshot.warnings`: stored records the store skipped because they failed validation. */
  warnings?: string[];
}

/**
 * Tells the user that some stored entries could not be read, e.g. after a direct edit in Google
 * Sheets, and names each one so it can be fixed at the source.
 */
export function SkippedRowsNotice({ warnings }: SkippedRowsNoticeProps) {
  if (!warnings || warnings.length === 0) return null;
  const count = warnings.length;

  return (
    <section
      aria-label="Entries that could not be read"
      className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm"
    >
      <p className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span>
          {`${count} stored ${count === 1 ? "entry" : "entries"} could not be read and ${count === 1 ? "is" : "are"} not shown. `}
          This usually means the project file was edited by hand.
        </span>
      </p>
      <details className="pl-6 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none text-foreground">Show details</summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-mono [overflow-wrap:anywhere]">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
