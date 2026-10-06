import {
  type Option,
  buildInstruction,
  extractOptionsJson,
  validateOptionsPayload,
} from "@decisionator/core";
import type React from "react";
import { useState } from "react";

export interface ConnectAgentProps {
  pastedText: string;
  localeHint?: string;
  onFormatted: (options: Option[], rawAnswer: string) => void;
}

export const ConnectAgent: React.FC<ConnectAgentProps> = ({
  pastedText,
  localeHint,
  onFormatted,
}) => {
  const [agentUrl, setAgentUrl] = useState("http://127.0.0.1:4178");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleAutoFormat = async () => {
    if (!pastedText.trim()) {
      setError("Please paste your idea text first.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMsg("Connecting to agent...");

    try {
      const prompt = buildInstruction(pastedText, localeHint);

      // Attempt calling agent endpoint
      // Supports both REST agent node and direct MCP/REST bridges
      const endpoint = `${agentUrl.replace(/\/$/, "")}/api/v1/session`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      setStatusMsg("Sending formatting prompt to agent...");
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentName: "DecisionatorWebClient",
          prompt,
        }),
      }).catch((err) => {
        throw new Error(`Failed to reach agent at ${agentUrl}: ${err.message}`);
      });

      if (!res.ok) {
        // If agent endpoint doesn't support direct prompt execution, attempt /complete or mock formatting
        const errJson = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errJson.message || `Agent returned status ${res.status}`);
      }

      const data = (await res.json()) as { answer?: string; result?: string };
      const rawText = data.answer || data.result || JSON.stringify(data);

      setStatusMsg("Validating agent response...");
      const extraction = extractOptionsJson(rawText);
      const targetJson =
        extraction.kind === "single"
          ? extraction.json
          : extraction.kind === "choose"
            ? extraction.candidates[0]
            : null;

      if (!targetJson) {
        throw new Error("Agent response did not contain valid options JSON format.");
      }

      const valReport = validateOptionsPayload(targetJson);
      if (!valReport.ok) {
        throw new Error(`Validation failed: ${valReport.errors.join(", ")}`);
      }

      const normalized: Option[] = valReport.options.map((opt, idx) => ({
        id: opt.id || `opt_${Date.now()}_${idx}`,
        order: idx + 1,
        status: "active",
        title: opt.title,
        description: opt.description,
        category: opt.category,
        tags: opt.tags,
        pros: opt.pros,
        cons: opt.cons,
        effort: opt.effort,
        links: opt.links,
      }));

      setStatusMsg("Formatting complete!");
      onFormatted(normalized, rawText);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        border: "1px solid var(--accent, #6366f1)",
        background: "rgba(99, 102, 241, 0.04)",
        padding: 16,
        marginBottom: 16,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0, color: "var(--accent, #6366f1)" }}>
          ⚡ Fast Path: Connected Agent (FR-041)
        </h4>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Skip copy-paste</span>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 12px 0" }}>
        Connect directly to your local or remote agent node (MCP/REST at <code>127.0.0.1:4178</code>
        ) to format options automatically in one click.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="text"
          value={agentUrl}
          onChange={(e) => setAgentUrl(e.target.value)}
          placeholder="http://127.0.0.1:4178"
          style={{
            flex: "1 1 200px",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 13,
          }}
          disabled={loading}
        />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer token (optional if open)"
          style={{
            flex: "1 1 180px",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 13,
          }}
          disabled={loading}
        />
        <button
          type="button"
          onClick={handleAutoFormat}
          disabled={loading}
          className="btn btn-primary"
          style={{ fontSize: 13 }}
        >
          {loading ? "Formatting..." : "Auto-format with Agent"}
        </button>
      </div>

      {statusMsg && !error && (
        <div style={{ fontSize: 12, color: "var(--accent, #6366f1)" }}>{statusMsg}</div>
      )}

      {error && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 4,
            background: "rgba(239, 68, 68, 0.1)",
            color: "var(--error, #ef4444)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};
