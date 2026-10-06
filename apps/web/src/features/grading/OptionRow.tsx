import type { Option } from "@decisionator/core";
import { ChevronDown, ExternalLink, Info, MessageSquare, Minus, Plus } from "lucide-react";
import type React from "react";
import { useId, useState } from "react";
import { HoverPopover } from "../../components/ui/popover.js";
import { cn } from "../../lib/utils.js";
import { GradeInput } from "./GradeInput.js";

export interface OptionRowProps {
  option: Option;
  index: number;
  averageGrade?: number;
  gradeCount?: number;
  commentCount?: number;
  myGrade?: number;
  canGrade: boolean;
  onGrade: (value: number) => void;
  /** The option's comment thread, shown when the comments toggle is expanded. */
  comments: React.ReactNode;
}

const metaButton =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9";

/**
 * Minimal option row for grading: title, a two-line description and the star rating up front;
 * pros/cons, links and tags live in a hover/tap "Details" popover and comments in a disclosure.
 */
export const OptionRow: React.FC<OptionRowProps> = ({
  option,
  index,
  averageGrade,
  gradeCount = 0,
  commentCount = 0,
  myGrade,
  canGrade,
  onGrade,
  comments,
}) => {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const commentsId = useId();

  const hasDetails =
    option.pros.length > 0 ||
    option.cons.length > 0 ||
    option.links.length > 0 ||
    option.tags.length > 0 ||
    Boolean(option.effort) ||
    option.description.length > 140;

  return (
    <li className="group px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {/* Option text */}
        <div className="min-w-0 flex-1 space-y-1">
          <h4 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[15px] font-medium leading-snug text-foreground">
            <span className="text-xs tabular-nums text-muted-foreground" aria-hidden>
              {index + 1}.
            </span>
            <span className="[overflow-wrap:anywhere]">{option.title}</span>
            {option.category && (
              <span className="text-xs font-normal text-muted-foreground">{option.category}</span>
            )}
          </h4>
          {option.description && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {option.description}
            </p>
          )}

          {/* Secondary info, kept quiet */}
          <div className="-ml-1.5 flex flex-wrap items-center gap-0.5 pt-0.5">
            {hasDetails && (
              <HoverPopover
                trigger={
                  <button
                    type="button"
                    className={metaButton}
                    aria-label={`Details for ${option.title}`}
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden />
                    <span>Details</span>
                    {option.pros.length > 0 && (
                      <span className="tabular-nums">+{option.pros.length}</span>
                    )}
                    {option.cons.length > 0 && (
                      <span className="tabular-nums">−{option.cons.length}</span>
                    )}
                  </button>
                }
              >
                <OptionDetailsContent option={option} />
              </HoverPopover>
            )}

            <button
              type="button"
              className={cn(metaButton, commentsOpen && "bg-accent text-foreground")}
              aria-expanded={commentsOpen}
              aria-controls={commentsId}
              onClick={() => setCommentsOpen((o) => !o)}
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              <span>
                {commentCount > 0
                  ? `${commentCount} comment${commentCount === 1 ? "" : "s"}`
                  : "Comment"}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform motion-reduce:transition-none",
                  commentsOpen && "rotate-180"
                )}
                aria-hidden
              />
            </button>
          </div>
        </div>

        {/* Rating */}
        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
          <GradeInput
            value={myGrade}
            optionId={option.id}
            label={`Your rating for ${option.title}`}
            showMeta={false}
            disabled={!canGrade}
            onChange={onGrade}
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {averageGrade !== undefined && gradeCount > 0
              ? `${averageGrade.toFixed(1)} avg · ${gradeCount} ${gradeCount === 1 ? "rating" : "ratings"}`
              : "No ratings yet"}
          </span>
        </div>
      </div>

      {commentsOpen && (
        <div id={commentsId} className="mt-3 rounded-lg bg-muted/40 p-3 sm:ml-5">
          {comments}
        </div>
      )}
    </li>
  );
};

function OptionDetailsContent({ option }: { option: Option }) {
  return (
    <div className="space-y-3 text-sm">
      {option.description.length > 140 && (
        <p className="leading-relaxed text-muted-foreground">{option.description}</p>
      )}

      {option.pros.length > 0 && (
        <section className="space-y-1">
          <h5 className="text-xs font-medium text-muted-foreground">Pros</h5>
          <ul className="space-y-1">
            {option.pros.map((pro) => (
              <li key={pro} className="flex items-start gap-2">
                <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                <span>{pro}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {option.cons.length > 0 && (
        <section className="space-y-1">
          <h5 className="text-xs font-medium text-muted-foreground">Cons</h5>
          <ul className="space-y-1">
            {option.cons.map((con) => (
              <li key={con} className="flex items-start gap-2">
                <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                <span>{con}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(option.effort || option.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {option.effort && (
            <span className="rounded-md bg-muted px-1.5 py-0.5">Effort {option.effort}</span>
          )}
          {option.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {option.links.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2">
          {option.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
              >
                <span className="truncate">{link.title || link.url}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default OptionRow;
