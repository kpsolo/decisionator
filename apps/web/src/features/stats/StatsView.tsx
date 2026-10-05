import type { GroupKey, OptionStats, SortKey } from "@decisionator/core";
import { sortAndGroupStats } from "@decisionator/core";
import type React from "react";
import { useMemo, useState } from "react";

export interface StatsViewProps {
  stats: OptionStats[];
  showBordaSort?: boolean;
}

export const StatsView: React.FC<StatsViewProps> = ({ stats, showBordaSort = false }) => {
  const [sortBy, setSortBy] = useState<SortKey>("average");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual");

  const groups = useMemo(() => {
    return sortAndGroupStats(stats, sortBy, groupBy);
  }, [stats, sortBy, groupBy]);

  return (
    <div className="stats-view card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>Project Statistics & Distributions</h3>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Sort by:{" "}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              <option value="average">Highest Average</option>
              <option value="count">Most Ratings</option>
              <option value="comments">Most Comments</option>
              {showBordaSort && <option value="bordaPoints">Borda Points</option>}
              <option value="title">Title (A-Z)</option>
            </select>
          </label>

          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Group by:{" "}
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupKey)}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              <option value="none">None</option>
              <option value="category">Category</option>
              <option value="tag">Tag</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => setViewMode(viewMode === "visual" ? "table" : "visual")}
            className="btn btn-outline"
            style={{ fontSize: 12, padding: "4px 8px" }}
          >
            {viewMode === "visual" ? "Table View" : "Visual View"}
          </button>
        </div>
      </div>

      {viewMode === "table" ? (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ padding: "8px 12px" }}>Option</th>
                <th style={{ padding: "8px 12px" }}>Category</th>
                <th style={{ padding: "8px 12px" }}>Average</th>
                <th style={{ padding: "8px 12px" }}>Ratings</th>
                <th style={{ padding: "8px 12px" }}>Comments</th>
              </tr>
            </thead>
            <tbody>
              {groups
                .flatMap((g) => g.items)
                .map((item) => (
                  <tr key={item.optionId} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{item.title}</td>
                    <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>
                      {item.category || "—"}
                    </td>
                    <td style={{ padding: "8px 12px", color: "#eab308", fontWeight: 600 }}>
                      ★ {item.average.toFixed(1)}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{item.count}</td>
                    <td style={{ padding: "8px 12px" }}>{item.commentsCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {groups.map((group) => (
            <div key={group.groupName}>
              {groupBy !== "none" && (
                <h4
                  style={{
                    margin: "0 0 10px 0",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 4,
                  }}
                >
                  {group.groupName} ({group.items.length})
                </h4>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {group.items.map((item) => (
                  <div
                    key={item.optionId}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: 12,
                      background: "var(--bg)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: 8,
                      }}
                    >
                      <strong style={{ fontSize: 14 }}>{item.title}</strong>
                      <div>
                        <span style={{ color: "#eab308", fontWeight: 600, fontSize: 15 }}>
                          ★ {item.average.toFixed(1)}
                        </span>{" "}
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          ({item.count} votes, {item.commentsCount} comments)
                        </span>
                      </div>
                    </div>

                    {/* Distribution Bars */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {[5, 4, 3, 2, 1].map((star) => {
                        const cnt = item.distribution[star - 1] || 0;
                        const pct = item.count > 0 ? (cnt / item.count) * 100 : 0;
                        return (
                          <div
                            key={star}
                            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}
                          >
                            <span style={{ width: 36, color: "var(--text-muted)" }}>
                              {star} star
                            </span>
                            <div
                              style={{
                                flex: 1,
                                height: 8,
                                background: "var(--card-bg)",
                                borderRadius: 4,
                                overflow: "hidden",
                                border: "1px solid var(--border)",
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  background: "#eab308",
                                  transition: "width 0.3s ease",
                                }}
                              />
                            </div>
                            <span
                              style={{ width: 24, textAlign: "right", color: "var(--text-muted)" }}
                            >
                              {cnt}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
