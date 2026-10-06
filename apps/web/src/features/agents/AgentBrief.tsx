import { Bot, Check, Clock, Copy, ShieldAlert, Terminal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";

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
    <Card className="border-agent-border/60 bg-agent/5">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-agent/15 text-agent">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                Agent Brief (FR-042, FR-043)
              </CardTitle>
            </div>
          </div>
          {onRevoke && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRevoke}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
              leftIcon={<ShieldAlert className="h-3.5 w-3.5" />}
            >
              Revoke Access
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-agent" aria-hidden="true" />
          <span>
            Copy this brief and provide it to your agent (Claude Code, Claude Desktop, Cursor, or
            script). The bearer token expires automatically on{" "}
            <strong className="text-foreground">{new Date(expiresAt).toLocaleTimeString()}</strong>.
          </span>
        </p>

        {/* Full brief preview */}
        <div className="relative">
          <pre className="rounded-lg border border-border bg-muted/50 p-3 text-xs font-mono text-foreground overflow-y-auto max-h-48 leading-relaxed whitespace-pre-wrap">
            {fullBrief}
          </pre>
          <Button
            type="button"
            size="sm"
            variant="agent"
            onClick={() => copyToClipboard(fullBrief, setCopiedBrief)}
            className="absolute top-2.5 right-2.5 text-xs h-7 px-2.5"
            leftIcon={
              copiedBrief ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />
            }
          >
            {copiedBrief ? "Copied!" : "Copy Full Brief"}
          </Button>
        </div>

        {/* Ready-made MCP Snippets */}
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-agent" aria-hidden="true" />
                Claude CLI command:
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(claudeCliCommand, setCopiedCli)}
                className="h-6 px-2 text-[11px]"
                leftIcon={copiedCli ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              >
                {copiedCli ? "Copied!" : "Copy"}
              </Button>
            </div>
            <code className="block rounded-md border border-border bg-muted/40 p-2 font-mono text-xs text-foreground break-all">
              {claudeCliCommand}
            </code>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">MCP Client JSON config:</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(claudeJsonSnippet, setCopiedJson)}
                className="h-6 px-2 text-[11px]"
                leftIcon={copiedJson ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              >
                {copiedJson ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] text-foreground overflow-x-auto">
              {claudeJsonSnippet}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
