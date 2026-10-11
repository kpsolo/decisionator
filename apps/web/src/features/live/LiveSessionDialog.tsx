import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Info,
  Loader2,
  Radio,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Input } from "../../components/ui/input.js";
import { Switch } from "../../components/ui/switch.js";
import { toast } from "../../components/ui/use-toast.js";
import { cn } from "../../lib/utils.js";
import { participantVoteResets } from "../history/reset-entries.js";
import { projectKey, useLiveShare } from "./LiveShareContext.js";
import { QrCode } from "./QrCode.js";
import { RevokeSessionDialog } from "./RevokeSessionDialog.js";
import { appBaseUrl, isLoopbackHost, joinUrl, savePublicBaseUrl } from "./live-config.js";
import { buildRoster, type LiveParticipantProfile } from "./participant-roster.js";

/**
 * The live session panel. Closing it only hides it: the session keeps running (see the header
 * indicator) until the host presses "End session" or closes the tab.
 */
export function LiveSessionDialog() {
  const live = useLiveShare();
  const target = live.dialogTarget;
  if (!target) return null;

  const session = live.session;
  const isThisProject = session?.key === projectKey(target.projectRef);
  const otherSession = session && !isThisProject ? session : null;

  return (
    <Dialog open onOpenChange={(open) => !open && live.closeDialog()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" aria-hidden />
            <span>Live session</span>
          </DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {otherSession
              ? `A live session is already running for "${otherSession.target.projectTitle}".`
              : `People with the link can grade, comment and vote on "${target.projectTitle}" while this tab stays open.`}
          </DialogDescription>
        </DialogHeader>

        {otherSession ? (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={live.closeDialog}>
              Keep it running
            </Button>
            <Button onClick={() => void live.start(target)}>End it and go live here</Button>
          </DialogFooter>
        ) : isThisProject && session ? (
          <LivePanel />
        ) : live.starting ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
            Starting the session…
          </p>
        ) : live.startError ? (
          <div className="space-y-3">
            <p
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{live.startError}</span>
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={live.closeDialog}>
                Close
              </Button>
              <Button onClick={() => void live.start(target)}>Try again</Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface LiveModerationProposal {
  id: string;
  agentName: string;
  action: "drop_votes" | "set_read_only" | "allow_contributions" | "revoke_link";
  participantId?: string;
  reason: string;
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
}

function LivePanel() {
  const live = useLiveShare();
  const session = live.session;
  const [base, setBase] = useState(appBaseUrl);
  const [copied, setCopied] = useState(false);
  const [dropTarget, setDropTarget] = useState<LiveParticipantProfile | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);

  if (!session) return null;

  // Track host's project snapshot
  useEffect(() => {
    const s = session.hosting.host.getSnapshot();
    if (s) setSnapshot(s);

    const unwatch = session.target.store.watch(session.target.projectRef, (updated) => {
      setSnapshot(updated);
    });
    return () => {
      unwatch();
    };
  }, [session]);

  const loopback = isLoopbackHost();
  const url = joinUrl(session.hosting.credentials, base);
  const guests = session.state.guests;
  const currentRole = session.hosting.host.getRole();

  const hostParticipantId = useMemo(() => {
    if (snapshot?.options[0]?.by) return snapshot.options[0].by;
    return "owner";
  }, [snapshot]);

  const roster = useMemo(() => {
    if (!snapshot) return [];
    return buildRoster(snapshot, guests, hostParticipantId);
  }, [snapshot, guests, hostParticipantId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast({
        title: "Could not copy the link",
        description: "Select the link and copy it manually.",
        variant: "destructive",
      });
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDropVotes = async () => {
    if (!dropTarget || !snapshot) return;
    try {
      const round = snapshot.project.voting?.round ?? 1;
      const resets = participantVoteResets(dropTarget.participantId, round);
      await session.target.store.append(session.target.projectRef, resets);
      toast({
        title: "Votes dropped",
        description: `Reset grades and ballot for ${dropTarget.name}.`,
      });
    } catch (err) {
      toast({
        title: "Could not drop votes",
        description: err instanceof Error ? err.message : "Failed to append reset entries.",
        variant: "destructive",
      });
    } finally {
      setDropTarget(null);
    }
  };

  const [proposals, setProposals] = useState<LiveModerationProposal[]>([]);

  const handleRevokeConfirm = () => {
    live.revoke("This session link has been revoked by the owner.");
    live.closeDialog();
    toast({
      title: "Session link revoked",
      description: "Connected guests were disconnected and the link was deactivated.",
    });
  };

  // Sync state with local agent bridge and fetch pending moderation proposals (US6)
  useEffect(() => {
    let active = true;
    const syncAgentBridge = async () => {
      try {
        await fetch("http://127.0.0.1:4178/api/v1/live-session", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer deci_agent_token_local",
          },
          body: JSON.stringify({
            hosting: true,
            readOnly: currentRole === "view",
            revoked: false,
            participants: roster.map((r) => ({
              participantId: r.participantId,
              name: r.name,
              isHost: r.isHost,
              online: r.online,
              gradeCount: r.gradeCount,
              hasBallot: r.hasBallot,
            })),
          }),
        });

        const res = await fetch("http://127.0.0.1:4178/api/v1/live-session/proposals", {
          headers: { Authorization: "Bearer deci_agent_token_local" },
        });
        if (res.ok && active) {
          const data = (await res.json()) as { proposals?: LiveModerationProposal[] };
          if (Array.isArray(data.proposals)) {
            setProposals(data.proposals.filter((p) => p.status === "pending"));
          }
        }
      } catch {
        // Node not running locally
      }
    };

    void syncAgentBridge();
    const interval = setInterval(syncAgentBridge, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentRole, roster]);

  const handleAcceptProposal = async (prop: LiveModerationProposal) => {
    try {
      if (prop.action === "drop_votes" && prop.participantId && snapshot) {
        const round = snapshot.project.voting?.round ?? 1;
        const resets = participantVoteResets(prop.participantId, round);
        await session.target.store.append(session.target.projectRef, resets);
      } else if (prop.action === "set_read_only") {
        live.setRole("view");
      } else if (prop.action === "allow_contributions") {
        live.setRole("contribute");
      } else if (prop.action === "revoke_link") {
        live.revoke("This session link has been revoked by the owner.");
      }

      try {
        await fetch(`http://127.0.0.1:4178/api/v1/live-session/proposals/${prop.id}/decision`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer deci_agent_token_local",
          },
          body: JSON.stringify({ decision: "accepted" }),
        });
      } catch {
        // Node not running
      }

      setProposals((prev) => prev.filter((p) => p.id !== prop.id));
      toast({
        title: "Proposal accepted",
        description: `Applied ${prop.action} proposed by ${prop.agentName || "Agent"}.`,
      });
    } catch (err) {
      toast({
        title: "Failed to apply proposal",
        description: err instanceof Error ? err.message : "Failed to execute proposed action",
        variant: "destructive",
      });
    }
  };

  const handleDismissProposal = async (prop: LiveModerationProposal) => {
    try {
      await fetch(`http://127.0.0.1:4178/api/v1/live-session/proposals/${prop.id}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer deci_agent_token_local",
        },
        body: JSON.stringify({ decision: "dismissed" }),
      });
    } catch {
      // Node not running
    }

    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
    toast({
      title: "Proposal dismissed",
      description: `Dismissed proposal from ${prop.agentName || "Agent"}.`,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode value={url} label="QR code for the join link" size={148} />
        <div className="w-full min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success" className="gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full bg-success-foreground motion-safe:animate-pulse"
                aria-hidden
              />
              Live
            </Badge>
            <span className="flex items-center gap-1 text-xs font-medium" aria-live="polite">
              <Users className="h-3.5 w-3.5 text-primary" aria-hidden />
              {guests.length === 1 ? "1 person connected" : `${guests.length} people connected`}
            </span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="live-join-link" className="text-xs font-medium text-muted-foreground">
              Join link
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="live-join-link"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                onClick={copy}
                className="h-9 shrink-0"
                leftIcon={
                  copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  )
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Role Control (US5, FR-015) */}
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <label htmlFor="read-only-toggle" className="text-xs font-medium cursor-pointer">
            Read-only mode
          </label>
          <p className="text-[11px] text-muted-foreground">
            {currentRole === "view"
              ? "Session is view-only. Connected guests cannot submit grades, comments, or ballots."
              : "Contributions allowed. Guests can submit grades, comments, and ballots."}
          </p>
        </div>
        <Switch
          id="read-only-toggle"
          checked={currentRole === "view"}
          onCheckedChange={(checked) => live.setRole(checked ? "view" : "contribute")}
        />
      </div>

      {/* Agent Moderation Proposals (US6, Staged Compliance D1) */}
      {proposals.length > 0 && (
        <div
          className="space-y-2 rounded-lg border border-agent-border bg-agent/5 p-3"
          role="region"
          aria-label="Agent moderation proposals"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-agent">
              <Bot className="h-4 w-4" aria-hidden />
              <span>Agent Moderation Proposals ({proposals.length})</span>
            </div>
            <span className="text-[11px] text-muted-foreground">Requires owner decision</span>
          </div>

          <div className="space-y-2">
            {proposals.map((prop) => {
              const participant = roster.find((r) => r.participantId === prop.participantId);
              const targetName = participant?.name ?? prop.participantId ?? "participant";
              const actionText =
                prop.action === "drop_votes"
                  ? `Drop votes for ${targetName}`
                  : prop.action === "set_read_only"
                    ? "Set session to read-only"
                    : prop.action === "allow_contributions"
                      ? "Allow contributions"
                      : "Revoke session link";

              return (
                <div
                  key={prop.id}
                  className="space-y-2 rounded-md border border-border bg-card p-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        {prop.agentName || "Agent"} proposes: {actionText}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        Pending
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{prop.reason}</p>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => handleDismissProposal(prop)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs bg-agent text-agent-foreground hover:bg-agent/90"
                      onClick={() => handleAcceptProposal(prop)}
                    >
                      Accept
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Participant Roster (US5, FR-014, FR-030) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Participant Roster ({roster.length})
          </h4>
          <span className="text-[11px] text-muted-foreground">
            {roster.filter((r) => r.online).length} online
          </span>
        </div>

        <div className="max-h-44 overflow-y-auto space-y-1 rounded-md border border-border p-2">
          {roster.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">No participants yet</p>
          ) : (
            roster.map((p) => (
              <div
                key={p.participantId}
                className="flex items-center justify-between gap-2 py-1.5 px-2 text-xs rounded hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 shrink-0 rounded-full",
                      p.online ? "bg-success" : "bg-muted-foreground/30"
                    )}
                    title={p.online ? "Online" : "Offline"}
                    aria-hidden
                  />
                  <span className="truncate font-medium">{p.name}</span>
                  {p.isHost && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      Host
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground text-[11px]">
                    {p.gradeCount} {p.gradeCount === 1 ? "grade" : "grades"}
                    {p.hasBallot ? " • Ballot cast" : ""}
                  </span>
                  {!p.isHost && (p.gradeCount > 0 || p.hasBallot) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                      onClick={() => setDropTarget(p)}
                    >
                      Drop votes
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {loopback && (
        <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5">
          <p className="flex gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              This page runs on <code className="font-mono text-xs">localhost</code>, which other
              devices cannot open. Enter the address they can reach, such as this computer's network
              address or the hosted app.
            </span>
          </p>
          <label htmlFor="live-public-base" className="sr-only">
            Address guests open
          </label>
          <Input
            id="live-public-base"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              savePublicBaseUrl(e.target.value.trim() || null);
            }}
            placeholder="http://192.168.1.20:5173/decisionator/"
            className="h-9 font-mono text-xs"
          />
        </div>
      )}

      <p className="m-0 flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Votes travel directly between browsers and are saved into this project. Encrypted
          connection offers pass through public relays, which see no project data. Closing this
          window keeps the session running.
        </span>
      </p>

      <DialogFooter className="border-t border-border pt-3 flex items-center justify-between sm:justify-between">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          leftIcon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => setRevokeOpen(true)}
        >
          Revoke link
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={live.closeDialog}>
            Hide
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              live.stop("The host ended the session.");
              live.closeDialog();
            }}
          >
            End session
          </Button>
        </div>
      </DialogFooter>

      {/* Confirmation modal for dropping participant votes (US5, FR-030) */}
      {dropTarget && (
        <Dialog open onOpenChange={(open) => !open && setDropTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Drop votes from {dropTarget.name}?</DialogTitle>
              <DialogDescription>
                This will reset all grades and the current round ballot submitted by{" "}
                <span className="font-semibold text-foreground">{dropTarget.name}</span>. Historical audit
                trail is preserved in project history.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setDropTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDropVotes}>
                Drop votes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Confirmation modal for revoking link (US5, FR-008) */}
      <RevokeSessionDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        projectTitle={session.target.projectTitle}
        onConfirm={handleRevokeConfirm}
      />
    </div>
  );
}
