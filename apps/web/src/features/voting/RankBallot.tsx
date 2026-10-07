import type { Option } from "@decisionator/core";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, CheckCircle2, GripVertical, Send } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { ExposureBox } from "../option-view/OptionPlaces.js";

export interface RankBallotProps {
  options: Option[];
  topN: number;
  initialRanking?: string[];
  disabled?: boolean;
  disabledReason?: string;
  onSubmitBallot: (ranking: string[]) => Promise<void>;
}

interface SortableOptionItemProps {
  option: Option;
  rank: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
}

const SortableOptionItem: React.FC<SortableOptionItemProps> = ({
  option,
  rank,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  disabled,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mb-2 flex items-center justify-between rounded-lg border p-3 transition-colors ${
        isDragging
          ? "border-primary bg-primary/10 shadow-md z-10"
          : "border-border bg-card/60 hover:bg-card shadow-2xs"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
            rank <= 3
              ? "border-warning/40 bg-warning/20 text-foreground"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          #{rank}
        </span>
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className={`rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:text-muted-foreground ${
            disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <div className="font-semibold text-sm text-foreground truncate">{option.title}</div>
          {option.description && (
            <div className="mt-0.5 text-xs text-muted-foreground truncate max-w-sm sm:max-w-md">
              {option.description}
            </div>
          )}
        </div>
      </div>

      {/* Accessible Keyboard Controls */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onMoveUp}
          disabled={disabled || !canMoveUp}
          aria-label={`Move ${option.title} up`}
          className="h-7 w-7"
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onMoveDown}
          disabled={disabled || !canMoveDown}
          aria-label={`Move ${option.title} down`}
          className="h-7 w-7"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
};

export const RankBallot: React.FC<RankBallotProps> = ({
  options,
  topN,
  initialRanking,
  disabled = false,
  disabledReason,
  onSubmitBallot,
}) => {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    const active = options.filter((o) => o.status === "active").map((o) => o.id);
    if (initialRanking && initialRanking.length > 0) {
      const rest = active.filter((id) => !initialRanking.includes(id));
      return [...initialRanking.filter((id) => active.includes(id)), ...rest];
    }
    return active;
  });

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrderedIds((items) => {
        const oldIndex = items.indexOf(String(active.id));
        const newIndex = items.indexOf(String(over.id));
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= orderedIds.length) return;
    setOrderedIds((items) => arrayMove(items, index, targetIndex));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    try {
      setLoading(true);
      const rankedTopN = orderedIds.slice(0, topN);
      await onSubmitBallot(rankedTopN);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch {
      // The caller reports why the ballot was not saved; just don't claim it was.
    } finally {
      setLoading(false);
    }
  };

  const optionMap = new Map(options.map((o) => [o.id, o]));

  return (
    <Card className="max-w-xl mx-auto border-border bg-card shadow-xs">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg font-bold">Rank Your Top {topN} Options</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Drag or use the arrows to arrange your preferred options. The top {topN} options earn
              Borda ranking points (1st = {topN} pts, {topN}th = 1 pt).
            </p>
          </div>
          <Badge variant="secondary" className="text-xs shrink-0">
            Top {topN} of {orderedIds.length}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {disabled && disabledReason && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground font-medium">
            {disabledReason}
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <div>
              {orderedIds.map((id, index) => {
                const opt = optionMap.get(id);
                if (!opt) return null;
                return (
                  <ExposureBox key={opt.id} optionId={opt.id}>
                    <SortableOptionItem
                      option={opt}
                      rank={index + 1}
                      disabled={disabled}
                      canMoveUp={index > 0}
                      canMoveDown={index < orderedIds.length - 1}
                      onMoveUp={() => handleMove(index, -1)}
                      onMoveDown={() => handleMove(index, 1)}
                    />
                    {index === topN - 1 && index < orderedIds.length - 1 && (
                      <div
                        aria-hidden
                        className="mt-3 mb-4 flex items-center justify-center border-b-2 border-dashed border-border/80"
                      >
                        <span className="translate-y-1/2 bg-card px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Top {topN} cutoff
                        </span>
                      </div>
                    )}
                  </ExposureBox>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        <div className="border-t border-border pt-4 flex items-center justify-end gap-3">
          {submitted && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              Ballot submitted successfully!
            </span>
          )}
          <Button
            type="button"
            variant="default"
            onClick={handleSubmit}
            disabled={disabled || loading}
            leftIcon={<Send className="h-4 w-4" aria-hidden />}
          >
            {loading ? "Submitting..." : initialRanking ? "Update Ballot" : "Submit Ballot"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default RankBallot;
