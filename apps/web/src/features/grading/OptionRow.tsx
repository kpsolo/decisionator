import type { Option } from "@decisionator/core";
import {
  ArrowUpRight,
  ChevronDown,
  Clock,
  ExternalLink,
  Folder,
  Info,
  MessageSquare,
  Minus,
  Plus,
  Star,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import type React from "react";
import { useId, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../components/ui/dialog.js";
import { cn } from "../../lib/utils.js";
import { useExposureRef, useOptionView } from "../option-view/OptionExtensionsProvider.js";
import {
  OptionBadges,
  OptionFooter,
  OptionMarker,
  OptionMarkerFrame,
  OptionSections,
  PropertySection,
  markerTitleClass,
} from "../option-view/OptionPlaces.js";
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
  /** The option's comment thread, shown when the comments toggle is expanded or in the lightbox. */
  comments: React.ReactNode;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Option Card styled to match the Deci Figma specification:
 * - Card: bg: rgba(17, 17, 19, 0.95), border: 1px solid rgba(11, 132, 254, 0.5), rounded-[14px], shadow-[0px_8px_24px_-4px_rgba(0,0,0,0.5)], p-5
 * - Badge: 40x40px, rounded-[14px], bg: #0B84FE, white bold text
 * - Title: 22px semibold, color #0B84FE, ArrowUpRight icon
 * - Description: 15px, line-height 23px, color #A1A1AB
 * - Rating: 5 stars in a row beside "No ratings yet" / average score
 * - Actions (right side):
 *     - Details button with #0B84FE icon/text and #00D88C pros / #FF547B cons indicators
 *     - Comment button with #A1A1AB icon/text and chevron
 * - On click, opens separate lightbox with complete details
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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const commentsId = useId();
  // Plugin places (contract option-view): marker, badges and footer. Title, grading and
  // comments below stay host-owned.
  const view = useOptionView(option, "card");
  const exposureRef = useExposureRef(option.id);

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a, fieldset, label")) {
      return;
    }
    setLightboxOpen(true);
  };

  const hasVoted = canGrade
    ? typeof myGrade === "number" && myGrade > 0
    : (typeof myGrade === "number" && myGrade > 0) || gradeCount > 0;

  return (
    <li
      ref={exposureRef}
      data-option-id={option.id}
      className={cn(
        "group relative flex flex-col items-start p-5 w-full rounded-[14px] transition-all duration-200 cursor-pointer",
        // Light mode
        "bg-card border border-border/80 shadow-sm hover:border-[#0B84FE] hover:shadow-[0px_8px_24px_-4px_rgba(11,132,254,0.18)]",
        // Dark mode (Deci spec)
        "dark:bg-[rgba(17,17,19,0.95)] dark:border-[rgba(11,132,254,0.5)] dark:shadow-[0px_8px_24px_-4px_rgba(0,0,0,0.5)] dark:hover:border-[#0B84FE] dark:hover:shadow-[0px_10px_28px_-4px_rgba(11,132,254,0.25)]"
      )}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          const target = e.target as HTMLElement;
          if (!target.closest("button, input, a, fieldset, label")) {
            e.preventDefault();
            setLightboxOpen(true);
          }
        }
      }}
    >
      <OptionMarkerFrame view={view} />
      {/* Top container: Left content + Right action buttons */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-6 w-full">
        {/* Left container: Badge + Text content */}
        <div className="flex flex-row items-start gap-3.5 flex-1 min-w-0 w-full">
          {/* Badge: 40x40px, rounded-[14px], blue only if voted */}
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] select-none text-sm leading-5 tracking-[-0.35px] transition-all duration-200",
              hasVoted
                ? "bg-[#0B84FE] border border-[#0B84FE] text-white font-bold shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
                : cn(
                    "bg-muted/70 border border-border text-muted-foreground font-semibold group-hover:border-slate-400 group-hover:text-foreground",
                    "dark:bg-white/[0.04] dark:border-white/12 dark:text-[#A1A1AB] dark:group-hover:border-white/25 dark:group-hover:text-white"
                  )
            )}
            aria-hidden="true"
          >
            {index + 1}
          </div>

          {/* Text & rating container */}
          <div className="flex flex-col items-start flex-1 min-w-0">
            {/* Title row */}
            <div className="flex flex-row items-center gap-2 min-h-8 w-full py-0.5">
              <OptionMarker view={view} />
              <h4
                className={cn(
                  "text-[20px] sm:text-[22px] font-semibold leading-tight tracking-[-0.45px] text-[#0066CC] dark:text-[#0B84FE] [overflow-wrap:anywhere] truncate",
                  markerTitleClass(view)
                )}
              >
                {option.title}
              </h4>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-[#0066CC] dark:text-[#0B84FE]"
                aria-hidden="true"
              />
            </div>

            {/* Description & stars container */}
            <div className="flex flex-col items-start pt-1.5 gap-4 w-full">
              {/* Description */}
              {option.description ? (
                <p className="text-[15px] leading-[23px] text-muted-foreground dark:text-[#A1A1AB] font-normal [overflow-wrap:anywhere] line-clamp-3">
                  {option.description}
                </p>
              ) : null}

              {/* Rating row: Stars + Text label */}
              <div className="flex flex-row items-center gap-2 flex-wrap">
                <GradeInput
                  value={myGrade}
                  optionId={option.id}
                  label={`Your rating for ${option.title}`}
                  showMeta={false}
                  size="lg"
                  disabled={!canGrade}
                  onChange={onGrade}
                  className="items-start"
                />
                <span className="text-xs leading-4 text-muted-foreground dark:text-[#A1A1AB] tabular-nums font-normal pl-0.5">
                  {averageGrade !== undefined && gradeCount > 0
                    ? `${averageGrade.toFixed(1)} avg · ${gradeCount} ${gradeCount === 1 ? "rating" : "ratings"}`
                    : "No ratings yet"}
                </span>
              </div>
              <OptionBadges view={view} />
            </div>
          </div>
        </div>

        {/* Right side actions container */}
        <div className="flex flex-row sm:flex-col items-start pt-1 sm:pt-2 gap-2 shrink-0">
          {/* Details button */}
          <button
            type="button"
            className="flex flex-row items-center px-2 gap-1.5 h-7 rounded-lg text-xs leading-4 text-[#0066CC] dark:text-[#0B84FE] hover:bg-[#0B84FE]/10 transition-colors pointer-coarse:h-9"
            onClick={() => setLightboxOpen(true)}
            aria-label={`Details for ${option.title}`}
          >
            <Info className="h-3.5 w-3.5 text-[#0066CC] dark:text-[#0B84FE]" aria-hidden="true" />
            <span>Details</span>
            {option.pros.length > 0 && (
              <span className="text-emerald-600 dark:text-[#00D88C] tabular-nums font-normal">
                +{option.pros.length}
              </span>
            )}
            {option.cons.length > 0 && (
              <span className="text-rose-600 dark:text-[#FF547B] tabular-nums font-normal">
                −{option.cons.length}
              </span>
            )}
          </button>

          {/* Comment button */}
          <button
            type="button"
            className={cn(
              "flex flex-row items-center px-2 gap-1.5 h-7 rounded-lg text-xs leading-4 transition-colors pointer-coarse:h-9",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              "dark:text-[#A1A1AB] dark:hover:bg-white/5 dark:hover:text-white",
              commentsOpen && "bg-accent text-foreground dark:bg-white/10 dark:text-white"
            )}
            aria-expanded={commentsOpen}
            aria-controls={commentsId}
            onClick={() => setCommentsOpen((o) => !o)}
          >
            <MessageSquare
              className="h-3.5 w-3.5 text-muted-foreground dark:text-[#A1A1AB]"
              aria-hidden="true"
            />
            <span>
              {commentCount > 0
                ? `${commentCount} comment${commentCount === 1 ? "" : "s"}`
                : "Comment"}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-muted-foreground dark:text-[#A1A1AB] transition-transform motion-reduce:transition-none",
                commentsOpen && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <OptionFooter view={view} option={option} className="mt-3 pl-[54px]" />

      {/* Quick comments disclosure below the card */}
      {commentsOpen && (
        <div
          id={commentsId}
          className="mt-4 w-full rounded-xl bg-muted/30 dark:bg-black/40 p-3.5 border border-border"
        >
          {comments}
        </div>
      )}

      {/* Superior Lightbox Dialog */}
      <OptionLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        option={option}
        index={index}
        averageGrade={averageGrade}
        gradeCount={gradeCount}
        commentCount={commentCount}
        myGrade={myGrade}
        canGrade={canGrade}
        onGrade={onGrade}
        comments={comments}
      />
    </li>
  );
};

interface OptionLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  option: Option;
  index: number;
  averageGrade?: number;
  gradeCount?: number;
  commentCount?: number;
  myGrade?: number;
  canGrade: boolean;
  onGrade: (value: number) => void;
  comments: React.ReactNode;
}

function OptionLightbox({
  open,
  onOpenChange,
  option,
  index,
  averageGrade,
  gradeCount = 0,
  commentCount = 0,
  myGrade,
  canGrade,
  onGrade,
  comments,
}: OptionLightboxProps) {
  const view = useOptionView(option, "detail");
  const exposureRef = useExposureRef(option.id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl gap-0 border border-border shadow-raised bg-background sm:rounded-2xl">
        {/* Lightbox Header banner */}
        <div ref={exposureRef} className="p-6 border-b border-border bg-muted/20 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <OptionMarker view={view} />
            <Badge variant="secondary" className="font-bold tabular-nums">
              Option #{index + 1}
            </Badge>
            {option.category && (
              <Badge variant="outline" className="gap-1.5 font-medium border-border/80">
                <Folder className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>Category: {option.category}</span>
              </Badge>
            )}
            {option.effort && (
              <Badge variant="outline" className="font-medium border-border/80">
                Effort: {option.effort}
              </Badge>
            )}
            {option.status && option.status !== "active" && (
              <Badge variant="secondary" className="capitalize">
                {option.status}
              </Badge>
            )}
            <OptionBadges view={view} />
          </div>

          <DialogTitle
            className={cn(
              "text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-snug [overflow-wrap:anywhere]",
              markerTitleClass(view)
            )}
          >
            {option.title}
          </DialogTitle>

          {(option.by || option.at) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
              {option.by && (
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Proposed by {option.by}</span>
                </span>
              )}
              {option.by && option.at && <span aria-hidden="true">·</span>}
              {option.at && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{formatDate(option.at)}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Score & Rating Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 bg-card border-b border-border">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold text-xl border border-amber-500/20 tabular-nums">
              {averageGrade !== undefined && gradeCount > 0 ? averageGrade.toFixed(1) : "—"}
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <span>Average Score</span>
                <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden="true" />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {gradeCount > 0
                  ? `${gradeCount} ${gradeCount === 1 ? "rating submitted" : "ratings submitted"}`
                  : "No ratings recorded yet"}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Your Rating:</span>
            <GradeInput
              value={myGrade}
              optionId={option.id}
              label={`Your rating for ${option.title}`}
              showMeta={false}
              size="lg"
              disabled={!canGrade}
              onChange={onGrade}
            />
          </div>
        </div>

        {/* Lightbox Body */}
        <div className="p-6 space-y-6">
          {/* Description */}
          <section className="space-y-2">
            <h5 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Description
            </h5>
            <div className="text-sm sm:text-base leading-relaxed text-foreground whitespace-pre-line bg-muted/20 p-4 rounded-xl border border-border/50">
              {option.description || (
                <span className="italic text-muted-foreground">
                  No description provided for this option.
                </span>
              )}
            </div>
          </section>

          {/* Pros & Cons Section */}
          {(option.pros.length > 0 || option.cons.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Pros */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                    <span>Pros</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs"
                  >
                    {option.pros.length}
                  </Badge>
                </div>
                {option.pros.length > 0 ? (
                  <ul className="space-y-2">
                    {option.pros.map((pro) => (
                      <li key={pro} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 mt-0.5">
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        </div>
                        <span className="leading-snug">{pro}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs italic text-muted-foreground">No pros listed.</p>
                )}
              </div>

              {/* Cons */}
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-semibold text-sm">
                    <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                    <span>Cons</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs"
                  >
                    {option.cons.length}
                  </Badge>
                </div>
                {option.cons.length > 0 ? (
                  <ul className="space-y-2">
                    {option.cons.map((con) => (
                      <li key={con} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 mt-0.5">
                          <Minus className="h-3 w-3" aria-hidden="true" />
                        </div>
                        <span className="leading-snug">{con}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs italic text-muted-foreground">No cons listed.</p>
                )}
              </div>
            </div>
          )}

          {/* Links & References */}
          {option.links.length > 0 && (
            <section className="space-y-2.5">
              <h5 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Links & References
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {option.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 p-3 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/40 transition-colors text-sm group/link"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ExternalLink className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="truncate font-medium text-foreground group-hover/link:text-primary">
                        {link.title || link.url}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[120px]">
                      {getHostname(link.url)}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Tags */}
          {option.tags.length > 0 && (
            <section className="space-y-2">
              <h5 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Tags
              </h5>
              <div className="flex flex-wrap gap-1.5">
                {option.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs font-normal">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <PropertySection option={option} />
          <OptionSections view={view} />

          {/* Comments & Discussion */}
          <section className="space-y-3 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
              <h5 className="text-sm font-semibold text-foreground">
                Discussion {commentCount > 0 ? `(${commentCount})` : ""}
              </h5>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">{comments}</div>
          </section>
        </div>

        {/* Lightbox Footer */}
        <DialogFooter className="p-4 bg-muted/20 border-t border-border sm:justify-end sm:items-center">
          <OptionFooter view={view} option={option} className="sm:mr-auto" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OptionRow;
