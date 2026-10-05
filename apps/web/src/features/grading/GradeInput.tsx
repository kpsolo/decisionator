import type React from "react";

export interface GradeInputProps {
  value?: number;
  authorName?: string;
  updatedAt?: string;
  disabled?: boolean;
  onChange: (newValue: number) => void;
}

export const GradeInput: React.FC<GradeInputProps> = ({
  value,
  authorName,
  updatedAt,
  disabled = false,
  onChange,
}) => {
  return (
    <div
      className="grade-input"
      style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}
    >
      <fieldset
        style={{
          display: "flex",
          gap: 6,
          border: "none",
          padding: 0,
          margin: 0,
        }}
        aria-label="Grade option 1 to 5"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isSelected = value !== undefined && value >= star;
          return (
            <label
              key={star}
              style={{
                cursor: disabled ? "default" : "pointer",
                fontSize: 20,
                color: isSelected ? "#eab308" : "var(--text-muted)",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <input
                type="radio"
                name={`grade-${authorName || "default"}`}
                value={star}
                checked={value === star}
                disabled={disabled}
                onChange={() => onChange(star)}
                style={{
                  position: "absolute",
                  opacity: 0,
                  width: 1,
                  height: 1,
                  margin: -1,
                }}
                aria-label={`${star} star${star > 1 ? "s" : ""}`}
              />
              ★
            </label>
          );
        })}
      </fieldset>
      {(authorName || updatedAt) && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {authorName ? `by ${authorName}` : ""}
          {authorName && updatedAt ? " • " : ""}
          {updatedAt ? new Date(updatedAt).toLocaleTimeString() : ""}
        </span>
      )}
    </div>
  );
};
