import type { QuotaBudget } from "@decisionator/store-google-sheets";
import type React from "react";
import { useState } from "react";

export interface DevToolbarProps {
  budget?: QuotaBudget;
  onForce429?: () => void;
  onToggleOffline?: (offline: boolean) => void;
}

export const DevToolbar: React.FC<DevToolbarProps> = ({ budget, onForce429, onToggleOffline }) => {
  const [isOffline, setIsOffline] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  // Dev toolbar only active in non-production environments
  if (import.meta.env.PROD) {
    return null;
  }

  const handleForce429 = () => {
    if (budget) {
      budget.handleRateLimit();
    }
    onForce429?.();
  };

  const handleToggleOffline = () => {
    const nextState = !isOffline;
    setIsOffline(nextState);
    onToggleOffline?.(nextState);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        style={{
          position: "fixed",
          bottom: 12,
          right: 12,
          zIndex: 9999,
          background: "#3f3f46",
          color: "#fff",
          border: "1px solid #71717a",
          borderRadius: 16,
          padding: "4px 10px",
          fontSize: 11,
          cursor: "pointer",
          opacity: 0.8,
        }}
      >
        🛠️ Dev
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        background: "#18181b",
        border: "1px solid #3f3f46",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 12,
        color: "#f4f4f5",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #27272a",
          paddingBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600 }}>🛠️ Dev Toolbar (T072)</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          style={{
            background: "none",
            border: "none",
            color: "#a1a1aa",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleForce429}
          className="btn btn-outline"
          style={{ fontSize: 11, padding: "4px 8px" }}
        >
          ⚡ Force 429 Rate Limit
        </button>

        <button
          type="button"
          onClick={handleToggleOffline}
          className={`btn ${isOffline ? "btn-primary" : "btn-outline"}`}
          style={{ fontSize: 11, padding: "4px 8px" }}
        >
          {isOffline ? "🌐 Go Online" : "🔌 Go Offline"}
        </button>
      </div>
    </div>
  );
};
