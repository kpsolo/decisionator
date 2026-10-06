import type { Option } from "@decisionator/core";
import type React from "react";

export interface OptionDetailProps {
  option: Option;
  averageGrade?: number;
  gradeCount?: number;
  commentCount?: number;
}

export const OptionDetail: React.FC<OptionDetailProps> = ({
  option,
  averageGrade,
  gradeCount = 0,
  commentCount = 0,
}) => {
  return (
    <div className="option-detail card" style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <h4 style={{ margin: "0 0 6px 0" }}>{option.title}</h4>
          {option.category && (
            <span
              style={{
                fontSize: 12,
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
              }}
            >
              {option.category}
            </span>
          )}
        </div>

        <div style={{ textAlign: "right", fontSize: 13 }}>
          {averageGrade !== undefined ? (
            <div>
              <strong style={{ color: "var(--color-warning, #b45309)", fontSize: 16 }}>
                ★ {averageGrade.toFixed(1)}
              </strong>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>({gradeCount} ratings)</div>
            </div>
          ) : (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>No ratings</span>
          )}
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
            {commentCount} comment{commentCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {option.description && (
        <p style={{ marginTop: 12, marginBottom: 12, fontSize: 14, color: "var(--text)" }}>
          {option.description}
        </p>
      )}

      {(option.pros.length > 0 || option.cons.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
          {option.pros.length > 0 && (
            <div>
              <strong style={{ fontSize: 13, color: "var(--color-success, #16a34a)" }}>
                Pros:
              </strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 13 }}>
                {option.pros.map((pro) => (
                  <li key={pro}>{pro}</li>
                ))}
              </ul>
            </div>
          )}
          {option.cons.length > 0 && (
            <div>
              <strong style={{ fontSize: 13, color: "var(--color-danger, #dc2626)" }}>Cons:</strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 13 }}>
                {option.cons.map((con) => (
                  <li key={con}>{con}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {option.links && option.links.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Links:</strong>
          <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 13 }}>
            {option.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.title || link.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
