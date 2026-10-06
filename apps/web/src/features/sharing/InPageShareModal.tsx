import type { ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";
import { InPageHostServer } from "@decisionator/share-inpage";
import { Check, Copy, Info, Radio, Users } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
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

interface InPageShareModalProps {
  projectRef: ProjectRef;
  projectTitle: string;
  store: ProjectStore;
  onClose: () => void;
}

export const InPageShareModal: React.FC<InPageShareModalProps> = ({
  projectRef,
  projectTitle,
  store,
  onClose,
}) => {
  const [sessionId] = useState(
    () => `p2p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  );
  const [hostServer, setHostServer] = useState<InPageHostServer | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const server = new InPageHostServer({
      sessionId,
      projectRef,
      store,
      onPeerCountChange: (cnt) => setPeerCount(cnt),
    });
    setHostServer(server);

    return () => {
      server.close("Session ended by host");
    };
  }, [sessionId, projectRef, store]);

  const joinUrl = `${window.location.origin}${window.location.pathname}#/join/${sessionId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch (err: unknown) {
      toast({
        title: "Could not copy link",
        description: err instanceof Error ? err.message : "Clipboard access was denied.",
        variant: "destructive",
      });
      return;
    }
    setCopied(true);
    toast({
      title: "Join link copied!",
      description: "Direct in-page join link copied to clipboard.",
      variant: "success",
    });
    setTimeout(() => setCopied(false), 2500);
  };

  // Closing this dialog unmounts it, which ends the live session (see effect cleanup).
  // Like the original non-modal dialog, it only closes through an explicit control
  // (the X or "End Session"), never by Esc or an accidental click outside.
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" aria-hidden />
            <span>In-Page Live Session</span>
          </DialogTitle>
          <DialogDescription>
            Your browser tab is hosting this live voting session directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Live status */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5">
            <Badge variant="success" className="gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full bg-success-foreground motion-safe:animate-pulse"
                aria-hidden
              />
              <span>Live Host Active</span>
            </Badge>
            <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <Users className="h-3.5 w-3.5 text-primary" aria-hidden />
              <span>Connected Peers: {peerCount}</span>
            </span>
          </div>

          {/* Share Link */}
          <div className="space-y-1.5">
            <label
              htmlFor="join-link-input"
              className="text-xs font-semibold text-muted-foreground"
            >
              Temporary Direct Join Link
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="join-link-input"
                type="text"
                readOnly
                value={joinUrl}
                className="h-9 bg-background font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                onClick={handleCopy}
                leftIcon={
                  copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  )
                }
                className="h-9 shrink-0 text-xs"
              >
                {copied ? "Copied!" : "Copy Link"}
              </Button>
            </div>
          </div>

          <p className="m-0 flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Collaborators connecting with this link will stream votes and grades directly into
              this open browser tab. When you close this tab or this dialog, the live session will
              end.
            </span>
          </p>
        </div>

        <DialogFooter className="border-t border-border pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            End Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InPageShareModal;
