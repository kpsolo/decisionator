import { AlertTriangle, Check, Copy, Info, Loader2, Radio, Users } from "lucide-react";
import { useState } from "react";
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
import { toast } from "../../components/ui/use-toast.js";
import { projectKey, useLiveShare } from "./LiveShareContext.js";
import { QrCode } from "./QrCode.js";
import { appBaseUrl, isLoopbackHost, joinUrl, savePublicBaseUrl } from "./live-config.js";

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
      <DialogContent className="sm:max-w-lg">
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

function LivePanel() {
  const live = useLiveShare();
  const session = live.session;
  const [base, setBase] = useState(appBaseUrl);
  const [copied, setCopied] = useState(false);
  if (!session) return null;

  const loopback = isLoopbackHost();
  const url = joinUrl(session.hosting.credentials, base);
  const guests = session.state.guests;

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode value={url} label="QR code for the join link" size={168} />
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

          {guests.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Connected people">
              {guests.map((g) => (
                <li key={g.participantId}>
                  <Badge variant="outline">{g.name}</Badge>
                </li>
              ))}
            </ul>
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
          connection offers pass through public relays, which see no project data. The link stays
          the same for this project, so people can rejoin. Closing this window keeps the session
          running.
        </span>
      </p>

      <DialogFooter className="border-t border-border pt-3">
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
      </DialogFooter>
    </div>
  );
}
