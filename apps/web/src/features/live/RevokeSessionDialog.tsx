import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

export interface RevokeSessionDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  projectTitle?: string;
  onConfirm(purgeRelays: boolean): Promise<void> | void;
}

export function RevokeSessionDialog({
  open,
  onOpenChange,
  projectTitle,
  onConfirm,
}: RevokeSessionDialogProps) {
  const [purgeRelays, setPurgeRelays] = useState(true);
  const [revoking, setRevoking] = useState(false);

  const handleConfirm = async () => {
    try {
      setRevoking(true);
      await onConfirm(purgeRelays);
      onOpenChange(false);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden />
            <span>Revoke access link</span>
          </DialogTitle>
          <DialogDescription className="text-left text-sm">
            {projectTitle
              ? `Are you sure you want to revoke the shared link for "${projectTitle}"?`
              : "Are you sure you want to revoke this shared session link?"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm text-muted-foreground">
          <p>
            Connected guests will be immediately disconnected. Anyone opening the link will see that
            access was revoked. A new link will be generated if you host again later.
          </p>

          <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-xs leading-normal cursor-pointer select-none">
            <input
              type="checkbox"
              checked={purgeRelays}
              onChange={(e) => setPurgeRelays(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-destructive focus:ring-destructive"
            />
            <div className="space-y-0.5">
              <span className="font-medium text-foreground">Purge public relay snapshot</span>
              <p className="text-muted-foreground">
                Publishes a cryptographic tombstone event to Nostr relays, replacing any stored
                offline snapshot.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={revoking} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={revoking} onClick={handleConfirm}>
            {revoking ? "Revoking…" : "Revoke link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
