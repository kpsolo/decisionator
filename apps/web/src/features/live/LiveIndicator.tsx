import { Radio } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { useLiveShare } from "./LiveShareContext.js";

/** Header pill shown while this tab hosts a live session; opens the session panel. */
export function LiveIndicator() {
  const { session, openActive } = useLiveShare();
  if (!session) return null;
  const count = session.state.guests.length;
  return (
    <button
      type="button"
      onClick={openActive}
      aria-label={`Live session for ${session.target.projectTitle}, ${count} connected. Open session panel`}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-success/20 pointer-coarse:min-h-11",
        "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
    >
      <Radio className="h-3.5 w-3.5 text-success motion-safe:animate-pulse" aria-hidden />
      <span>Live</span>
      <span className="tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}
