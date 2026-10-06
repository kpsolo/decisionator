import { Star } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "../../lib/utils.js";

export interface GradeInputProps {
  value?: number;
  optionId?: string;
  authorName?: string;
  updatedAt?: string;
  disabled?: boolean;
  /** Accessible name for the star group, e.g. "Your rating for Picnic". */
  label?: string;
  /** Show the "by author • time" caption under the stars (default true). */
  showMeta?: boolean;
  size?: "sm" | "md";
  onChange: (newValue: number) => void;
}

export const GradeInput: React.FC<GradeInputProps> = ({
  value,
  optionId,
  authorName,
  updatedAt,
  disabled = false,
  label = "Grade option 1 to 5",
  showMeta = true,
  size = "md",
  onChange,
}) => {
  // Previewing a rating while pointing makes the 1–5 scale obvious before committing.
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = !disabled && hovered !== null ? hovered : (value ?? 0);

  return (
    <div className="inline-flex flex-col gap-1 items-end">
      <fieldset
        className="flex items-center border-0 p-0 m-0"
        aria-label={label}
        onPointerLeave={() => setHovered(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isLit = shown >= star;
          return (
            <label
              key={star}
              onPointerEnter={() => setHovered(star)}
              className={cn(
                "rounded select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                size === "sm" ? "p-0.5 pointer-coarse:p-2" : "p-1 pointer-coarse:p-2",
                disabled ? "cursor-default opacity-60" : "cursor-pointer"
              )}
            >
              <input
                type="radio"
                name={`grade-${optionId || "default"}-${authorName || "default"}`}
                value={star}
                checked={value === star}
                disabled={disabled}
                onChange={() => onChange(star)}
                className="sr-only"
                aria-label={`${star} star${star > 1 ? "s" : ""}`}
              />
              <Star
                aria-hidden="true"
                className={cn(
                  "transition-colors",
                  size === "sm" ? "h-4 w-4" : "h-5 w-5",
                  isLit ? "fill-rating text-rating" : "text-muted-foreground/70",
                  // Hover preview reads lighter than a committed rating.
                  isLit && hovered !== null && !disabled && "opacity-80"
                )}
              />
            </label>
          );
        })}
      </fieldset>
      {showMeta && (authorName || updatedAt) && (
        <span className="text-[11px] text-muted-foreground font-medium">
          {authorName ? `by ${authorName}` : ""}
          {authorName && updatedAt ? " • " : ""}
          {updatedAt ? new Date(updatedAt).toLocaleTimeString() : ""}
        </span>
      )}
    </div>
  );
};

export default GradeInput;
