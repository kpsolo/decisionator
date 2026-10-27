import { Bot, Check, Clock, Copy, KeyRound, Loader2, ShieldAlert, Terminal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { OwnerBridgeToken } from "./OwnerBridgeToken.js";
import {
  type AgentPermission,
  type AgentTarget,
  DEFAULT_NODE_URL,
  type MintedGrant,
  createAgentGrant,
  revokeAgentGrant,
  useOwnerToken,
} from "./owner-bridge.js";

export interface AgentBriefProps {
  /** The project id the node knows the project by. */
  projectId: string;
  projectTitle: string;
  target: {
    kind: "project" | "option";
    optionId?: string;
    optionTitle?: string;
  };
  nodeUrl?: string;
  instruction: string;
  /** Grant lifetime; default 24 hours. */
  lifetimeHours?: number;
}

/**
 * "Ask my agent" (agentic API 1.4.0): mints a real, scoped and expiring grant on the local node
 * through the owner bridge and shows the brief with its token. Without the node's owner token in
 * this tab, it explains how to connect instead of showing any token.
 */
export const AgentBrief: React.FC<AgentBriefProps> = ({
  projectId,
  projectTitle,
  target,
  nodeUrl = DEFAULT_NODE_URL,
  instruction,
  lifetimeHours,
}) => {
  const ownerToken = useOwnerToken();
  const [grant, setGrant] = useState<MintedGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grantTarget: AgentTarget =
    target.kind === "option" && target.optionId
      ? { kind: "option", optionId: target.optionId }
      : { kind: "project" };
  const permissions: AgentPermission[] =
    grantTarget.kind === "project"
      ? ["read", "contribute", "propose_options"]
      : ["read", "contribute"];

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setGrant(
        await createAgentGrant(
          { projectId, instruction, target: grantTarget, permissions, lifetimeHours },
          { nodeUrl }
        )
      );
    } catch (err) {
      setError(
        err instanceof TypeError
          ? `Could not reach the local node at ${nodeUrl}.`
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!grant) return;
    setBusy(true);
    setError(null);
    try {
      await revokeAgentGrant(grant.id, { nodeUrl });
      setGrant(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <CardHeader className="pb-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-agent/15 text-agent">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </div>
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            Agent Brief (FR-042, FR-043)
          </CardTitle>
        </div>
        {grant && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={revoke}
            disabled={busy}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
            leftIcon={<ShieldAlert className="h-3.5 w-3.5" />}
          >
            Revoke Access
          </Button>
        )}
      </div>
    </CardHeader>
  );

  return (
    <Card className="border-agent-border/60 bg-agent/5">
      {header}
      <CardContent className="space-y-4">
        {!ownerToken ? (
          <OwnerBridgeToken />
        ) : grant ? (
          <BriefContent
            projectTitle={projectTitle}
            target={target}
            nodeUrl={nodeUrl}
            token={grant.token}
            instruction={instruction}
            expiresAt={grant.expiresAt}
          />
        ) : (
          <div className="space-y-3">
            <OwnerBridgeToken compact />
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0 text-agent" aria-hidden="true" />
              <span>
                Create a scoped access token for your agent. It can read this project and propose
                contributions ({permissions.join(", ")}); a person reviews everything it adds.
              </span>
            </p>
            <Button
              type="button"
              size="sm"
              variant="agent"
              onClick={create}
              disabled={busy}
              leftIcon={
                busy ? (
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                )
              }
            >
              Create agent access
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

const BriefContent: React.FC<{
  projectTitle: string;
  target: AgentBriefProps["target"];
  nodeUrl: string;
  token: string;
  instruction: string;
  expiresAt: string;
}> = ({ projectTitle, target, nodeUrl, token, instruction, expiresAt }) => {
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
    <>
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
    </>
  );
};
