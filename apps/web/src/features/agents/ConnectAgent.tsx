import { type Option, buildInstruction } from "@decisionator/core";
import { AlertCircle, Bot, Sparkles, Zap } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { type ProjectMeta, parseOptionsJson } from "../paste-format/options-json.js";

export interface ConnectAgentProps {
  pastedText: string;
  localeHint?: string;
  onFormatted: (options: Option[], rawAnswer: string, project?: ProjectMeta) => void;
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

      const data = (await res.json()) as { answer?: unknown; result?: unknown };
      // Agents may return the answer as text (often fenced) or as an already-parsed object.
      const answer = data.answer ?? data.result ?? data;
      const rawText = typeof answer === "string" ? answer : JSON.stringify(answer);

      setStatusMsg("Validating agent response...");
      const parsed = parseOptionsJson(rawText);
      if (parsed.kind === "invalid") {
        throw new Error(`Agent response is not a valid options list: ${parsed.errors.join(", ")}`);
      }

      setStatusMsg("Formatting complete!");
      onFormatted(parsed.options, rawText, parsed.project);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-agent-border/60 bg-agent/5 mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold leading-none tracking-tight text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-agent" aria-hidden="true" />
            Fast Path: Connected Agent (FR-041)
          </h4>
          <span className="text-xs text-muted-foreground">Skip copy-paste</span>
        </div>
        <CardDescription className="text-xs">
          Connect directly to your local or remote agent node (MCP/REST at{" "}
          <code className="text-foreground font-mono">127.0.0.1:4178</code>) to format options
          automatically in one click.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="text"
            value={agentUrl}
            onChange={(e) => setAgentUrl(e.target.value)}
            placeholder="http://127.0.0.1:4178"
            aria-label="Agent node URL"
            disabled={loading}
            className="flex-1 text-xs"
          />
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Bearer token (optional if open)"
            aria-label="Bearer token"
            disabled={loading}
            className="sm:w-56 text-xs"
          />
          <Button
            type="button"
            variant="agent"
            size="sm"
            onClick={handleAutoFormat}
            disabled={loading}
            isLoading={loading}
            leftIcon={<Sparkles className="h-3.5 w-3.5" />}
            className="shrink-0"
          >
            {loading ? "Formatting..." : "Auto-format with Agent"}
          </Button>
        </div>

        {statusMsg && !error && (
          <div className="flex items-center gap-1.5 text-xs text-agent font-medium">
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{statusMsg}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
