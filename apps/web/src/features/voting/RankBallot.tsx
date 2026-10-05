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
import type React from "react";
import { useState } from "react";

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
    padding: "10px 14px",
    background: "var(--card-bg, #18181b)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: rank <= 3 ? "rgba(234, 179, 8, 0.2)" : "var(--bg)",
            color: rank <= 3 ? "var(--color-warning, #eab308)" : "var(--text-muted)",
            fontSize: 12,
            fontWeight: 700,
            border: "1px solid var(--border)",
          }}
        >
          #{rank}
        </span>
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          style={{
            cursor: disabled ? "default" : "grab",
            background: "none",
            border: "none",
            padding: 4,
            color: "var(--text-muted)",
            fontSize: 14,
          }}
          aria-label="Drag to reorder"
        >
          ⠿
        </button>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{option.title}</div>
          {option.description && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {option.description}
            </div>
          )}
        </div>
      </div>

      {/* Accessible Keyboard Controls */}
      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={disabled || !canMoveUp}
          className="btn btn-outline"
          style={{ padding: "2px 6px", fontSize: 11 }}
          aria-label={`Move ${option.title} up`}
        >
          ▲
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={disabled || !canMoveDown}
          className="btn btn-outline"
          style={{ padding: "2px 6px", fontSize: 11 }}
          aria-label={`Move ${option.title} down`}
        >
          ▼
        </button>
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
    } finally {
      setLoading(false);
    }
  };

  const optionMap = new Map(options.map((o) => [o.id, o]));

  return (
    <div className="card" style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 6px 0" }}>Rank Your Top {topN} Options</h3>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
          Drag or use the arrows to arrange your preferred options. The top {topN} options earn
          Borda ranking points (1st = {topN} pts, {topN}th = 1 pt).
        </p>
      </div>

      {disabled && disabledReason && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning, #eab308)",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {disabledReason}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div style={{ marginBottom: 20 }}>
            {orderedIds.map((id, index) => {
              const opt = optionMap.get(id);
              if (!opt) return null;
              return (
                <SortableOptionItem
                  key={opt.id}
                  option={opt}
                  rank={index + 1}
                  disabled={disabled}
                  canMoveUp={index > 0}
                  canMoveDown={index < orderedIds.length - 1}
                  onMoveUp={() => handleMove(index, -1)}
                  onMoveDown={() => handleMove(index, 1)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
        {submitted && (
          <span style={{ color: "var(--color-success, #22c55e)", fontSize: 13, fontWeight: 500 }}>
            Ballot submitted successfully!
          </span>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || loading}
          className="btn btn-primary"
        >
          {loading ? "Submitting..." : initialRanking ? "Update Ballot" : "Submit Ballot"}
        </button>
      </div>
    </div>
  );
};
