import type React from "react";
import { useState } from "react";

export interface AgentBriefProps {
  projectTitle: string;
  target: {
    kind: "project" | "option" | "idea";
    optionId?: string;
    optionTitle?: string;
  };
  nodeUrl?: string;
  token: string;
  instruction: string;
  expiresAt: string;
  onRevoke?: () => void;
}

export const AgentBrief: React.FC<AgentBriefProps> = ({
  projectTitle,
  target,
  nodeUrl = "http://127.0.0.1:4178",
  token,
  instruction,
  expiresAt,
  onRevoke,
}) => {
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const cleanNodeUrl = nodeUrl.replace(/\/$/, "");
  const mcpUrl = `${cleanNodeUrl}/mcp`;
  const restUrl = `${cleanNodeUrl}/api/v1`;
  const openApiUrl = `${cleanNodeUrl}/api/v1/openapi.json`;

  const targetDesc =
    target.kind === "option" && target.optionTitle
      ? `Option "${target.optionTitle}" in project "${projectTitle}"`
      : `Project "${projectTitle}"`;

  const fullBrief = [
    `# AGENT BRIEF: ${projectTitle}`,
    "",
    "## 1. TASK",
    `Target: ${targetDesc}`,
    `Instruction: ${instruction}`,
    "",
    "## 2. HOW TO CONNECT",
    `- MCP URL: ${mcpUrl}`,
    `- REST Base URL: ${restUrl}`,
    `- OpenAPI Spec: ${openApiUrl}`,
    `- Bearer Token: ${token}`,
    "",
    "## 3. RULES",
    "- Everything the agent adds is reviewed by a human before inclusion.",
    "- Always cite sources with accessible URLs where applicable.",
    "- Call complete_request when your task is finished.",
    "- Agents cannot cast ballots or decide on the user's behalf.",
    "",
    "## 4. EXPIRY",
    `Access ends: ${new Date(expiresAt).toLocaleString()} (UTC: ${expiresAt})`,
  ].join("\n");

  const claudeCliCommand = `claude mcp add decisionator ${mcpUrl} --header "Authorization: Bearer ${token}"`;

  const claudeJsonSnippet = JSON.stringify(
    {
      mcpServers: {
        decisionator: {
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2
  );

  const copyToClipboard = async (text: string, setter: (val: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div
      className="card"
      style={{
        border: "1px solid var(--accent, #6366f1)",
        borderRadius: 8,
        padding: 16,
        background: "var(--card-bg, #ffffff)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--accent, #6366f1)" }}>
          📋 Agent Brief (FR-042, FR-043)
        </h3>
        {onRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            className="btn btn-outline"
            style={{ fontSize: 12, color: "var(--error, #ef4444)" }}
          >
            Revoke Access
          </button>
        )}
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0" }}>
        Copy this brief and provide it to your agent (Claude Code, Claude Desktop, Cursor, or
        script). The bearer token expires automatically on{" "}
        {new Date(expiresAt).toLocaleTimeString()}.
      </p>

      {/* Full brief preview */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <pre
          style={{
            background: "var(--bg, #f8fafc)",
            padding: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            fontSize: 12,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            maxHeight: 220,
            overflowY: "auto",
            margin: 0,
          }}
        >
          {fullBrief}
        </pre>
        <button
          type="button"
          onClick={() => copyToClipboard(fullBrief, setCopiedBrief)}
          className="btn btn-primary"
          style={{ position: "absolute", top: 8, right: 8, fontSize: 12, padding: "4px 8px" }}
        >
          {copiedBrief ? "Copied!" : "Copy Full Brief"}
        </button>
      </div>

      {/* Ready-made MCP Snippets */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>Claude CLI command:</span>
            <button
              type="button"
              onClick={() => copyToClipboard(claudeCliCommand, setCopiedCli)}
              className="btn btn-outline"
              style={{ fontSize: 11, padding: "2px 6px" }}
            >
              {copiedCli ? "Copied!" : "Copy"}
            </button>
          </div>
          <code
            style={{
              display: "block",
              background: "var(--bg, #f8fafc)",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              fontSize: 12,
              wordBreak: "break-all",
            }}
          >
            {claudeCliCommand}
          </code>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>MCP Client JSON config:</span>
            <button
              type="button"
              onClick={() => copyToClipboard(claudeJsonSnippet, setCopiedJson)}
              className="btn btn-outline"
              style={{ fontSize: 11, padding: "2px 6px" }}
            >
              {copiedJson ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre
            style={{
              background: "var(--bg, #f8fafc)",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              fontSize: 11,
              fontFamily: "monospace",
              margin: 0,
            }}
          >
            {claudeJsonSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
};
