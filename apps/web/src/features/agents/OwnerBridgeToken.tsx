import { KeyRound, PlugZap, Unplug } from "lucide-react";
import type React from "react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { ownerTokenProblem, setOwnerToken, useOwnerToken } from "./owner-bridge.js";

/**
 * Lets the owner connect this tab to the local Deci node by pasting the owner token the node
 * printed when it started. Without it, agent access and the live-session bridge stay off.
 */
export const OwnerBridgeToken: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const token = useOwnerToken();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  if (token) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-foreground">
          <PlugZap className="h-3.5 w-3.5 text-success" aria-hidden />
          This tab is connected to the local node as the owner.
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          leftIcon={<Unplug className="h-3 w-3" aria-hidden />}
          onClick={() => setOwnerToken(null)}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  const connect = () => {
    const value = draft.trim();
    const problem = ownerTokenProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setOwnerToken(value);
    setDraft("");
    setError(null);
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <p className="flex gap-1.5 text-muted-foreground">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-agent" aria-hidden />
        <span>
          {compact
            ? "Agent features are off: this tab is not connected to the local node."
            : "Agent access needs the local Deci node (port 4178). Start it and paste the owner token it printed. The token stays in this tab only and is forgotten when the tab closes."}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Owner token of the local node
        </label>
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") connect();
          }}
          placeholder="Owner token"
          className="h-8 font-mono text-xs"
          aria-invalid={error ? true : undefined}
        />
        <Button type="button" size="sm" className="h-8 shrink-0" onClick={connect}>
          Connect
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
};
