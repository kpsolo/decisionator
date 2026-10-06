import type { AuditEvent, Contribution } from "@decisionator/core";
import type React from "react";
import { useState } from "react";

export interface ContributionReviewProps {
  contributions: Contribution[];
  auditEvents?: AuditEvent[];
  onReviewAction: (
    contributionId: string,
    action: "accepted" | "edited" | "dismissed",
    editedBody?: string
  ) => void;
  isOwnerOrEditor?: boolean;
}

export const ContributionReview: React.FC<ContributionReviewProps> = ({
  contributions,
  auditEvents = [],
  onReviewAction,
  isOwnerOrEditor = true,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "dismissed">("all");

  const filtered = contributions.filter((c) => {
    if (filter === "all") return true;
    return c.reviewStatus === filter;
  });

  const handleStartEdit = (c: Contribution) => {
    setEditingId(c.id);
    setEditText(c.body);
  };

  const handleSaveEdit = (id: string) => {
    onReviewAction(id, "edited", editText);
    setEditingId(null);
  };

  return (
    <div className="contribution-review card" style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>Agent Contributions & Review (FR-043)</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "pending", "accepted", "dismissed"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`btn ${filter === status ? "btn-primary" : "btn-outline"}`}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Contributions List */}
      {filtered.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          No {filter !== "all" ? filter : ""} contributions yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((c) => {
            const isEditing = editingId === c.id;
            const authorAttribution =
              c.author.kind === "agent"
                ? `${c.author.agentName || "Agent"} on behalf of ${c.author.onBehalfOf || "user"}`
                : c.by;

            return (
              <div
                key={c.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  background:
                    c.reviewStatus === "pending"
                      ? "rgba(234, 179, 8, 0.05)"
                      : c.reviewStatus === "accepted"
                        ? "rgba(34, 197, 94, 0.05)"
                        : "var(--bg)",
                }}
              >
                {/* Header / Attribution */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  <div>
                    <strong>{c.type.toUpperCase()}</strong> by{" "}
                    <span style={{ color: "var(--text)" }}>{authorAttribution}</span> •{" "}
                    {new Date(c.at).toLocaleDateString()}
                  </div>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background:
                        c.reviewStatus === "pending"
                          ? "#fef08a"
                          : c.reviewStatus === "accepted"
                            ? "#bbf7d0"
                            : c.reviewStatus === "edited"
                              ? "#bae6fd"
                              : "#f1f5f9",
                      color:
                        c.reviewStatus === "pending"
                          ? "#854d0e"
                          : c.reviewStatus === "accepted"
                            ? "#166534"
                            : c.reviewStatus === "edited"
                              ? "#075985"
                              : "#475569",
                    }}
                  >
                    {c.reviewStatus}
                  </span>
                </div>

                {/* Body or Edit Box */}
                {isEditing ? (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={4}
                      style={{
                        width: "100%",
                        padding: 8,
                        borderRadius: 4,
                        border: "1px solid var(--border)",
                        fontFamily: "inherit",
                        fontSize: 13,
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(c.id)}
                        className="btn btn-primary"
                        style={{ fontSize: 12, padding: "3px 8px" }}
                      >
                        Save & Mark Edited
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="btn btn-outline"
                        style={{ fontSize: 12, padding: "3px 8px" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{c.body}</p>
                )}

                {/* Pros & Cons */}
                {c.pros && c.pros.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4, color: "var(--success, #16a34a)" }}>
                    <strong>Pros:</strong> {c.pros.join(", ")}
                  </div>
                )}
                {c.cons && c.cons.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 2, color: "var(--error, #dc2626)" }}>
                    <strong>Cons:</strong> {c.cons.join(", ")}
                  </div>
                )}

                {/* Sources */}
                {c.sources && c.sources.length > 0 && (
                  <div style={{ fontSize: 11, marginTop: 6, color: "var(--text-muted)" }}>
                    <strong>Sources:</strong>{" "}
                    {c.sources.map((s, idx) => (
                      <span key={s.url}>
                        {idx > 0 && ", "}
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent, #6366f1)" }}
                        >
                          {s.title || s.url}
                        </a>
                      </span>
                    ))}
                  </div>
                )}

                {/* Review Action Buttons */}
                {isOwnerOrEditor && !isEditing && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    {c.reviewStatus !== "accepted" && (
                      <button
                        type="button"
                        onClick={() => onReviewAction(c.id, "accepted")}
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                      >
                        ✓ Accept
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleStartEdit(c)}
                      className="btn btn-outline"
                      style={{ fontSize: 11, padding: "3px 8px" }}
                    >
                      ✎ Edit
                    </button>
                    {c.reviewStatus !== "dismissed" && (
                      <button
                        type="button"
                        onClick={() => onReviewAction(c.id, "dismissed")}
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: "3px 8px", color: "var(--error, #ef4444)" }}
                      >
                        ✕ Dismiss
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Refused Actions Audit Log (FR-044) */}
      {auditEvents.length > 0 && (
        <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--error, #ef4444)" }}>
            🛡️ Audit Log: Refused Agent Actions (FR-044)
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {auditEvents.map((evt) => (
              <div
                key={evt.id}
                style={{
                  fontSize: 12,
                  padding: "6px 8px",
                  borderRadius: 4,
                  background: "rgba(239, 68, 68, 0.05)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  color: "var(--text)",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--error, #ef4444)" }}>
                  {evt.type} • {new Date(evt.at).toLocaleTimeString()}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {JSON.stringify(evt.details)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
