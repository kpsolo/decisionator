import type { ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";
import { AlertTriangle, Trash2 } from "lucide-react";
import type React from "react";
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
import { Input } from "../../components/ui/input.js";
import { getDatabase } from "../../sync/db.js";

export interface DeleteProjectProps {
  fileId: string;
  /** The store holding the project; deletion goes through it (Drive trash, local trash, …). */
  store: ProjectStore;
  projectRef: ProjectRef;
  projectTitle: string;
  isOwner: boolean;
  onDeleted: () => void;
  /** Controlled open state, e.g. when opened from a menu item; omit to use the built-in button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

export const DeleteProject: React.FC<DeleteProjectProps> = ({
  fileId,
  store,
  projectRef,
  projectTitle,
  isOwner,
  onDeleted,
  open,
  onOpenChange,
  hideTrigger = false,
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = onOpenChange ?? setUncontrolledOpen;
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async () => {
    try {
      setLoading(true);
      setError(null);

      // Owners trash the project in its store; others just drop it from their own list.
      if (isOwner) {
        await store.deleteProject(projectRef);
      } else {
        await store.forgetProject(projectRef);
      }

      // Clean local IndexedDB state
      const db = await getDatabase();
      await db.delete("snapshots", `google-sheets:${fileId}`);
      await db.delete("snapshots", `file:${fileId}`);
      await db.delete("snapshots", `firestore:${fileId}`);

      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setIsOpen(true);
      return;
    }
    // Every close path (Cancel, X, Esc, outside click) resets the confirmation, as before.
    if (loading) return;
    setIsOpen(false);
    setConfirmInput("");
  };

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(true)}
          leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
          className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {isOwner ? "Delete Project..." : "Remove from my list"}
        </Button>
      )}

      {isOpen && (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" aria-hidden />
                <span>{isOwner ? "Delete Decision Project" : "Remove Project"}</span>
              </DialogTitle>
              <DialogDescription>
                {isOwner
                  ? `${ownerDeleteEffect(projectRef.store)} To confirm, type the project name "${projectTitle}" below:`
                  : "This will remove the project from your local list. You can re-open it anytime via the link."}
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive"
              >
                {error}
              </div>
            )}

            {isOwner && (
              <div className="space-y-1.5 pt-1">
                <label
                  htmlFor="delete-confirm-input"
                  className="text-xs font-semibold text-foreground"
                >
                  Confirmation Name:
                </label>
                <Input
                  id="delete-confirm-input"
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={projectTitle}
                  className="bg-background text-sm"
                />
              </div>
            )}

            <DialogFooter className="border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleAction}
                disabled={loading || (isOwner && confirmInput !== projectTitle)}
              >
                {loading ? "Processing..." : isOwner ? "Permanently Delete" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default DeleteProject;

function ownerDeleteEffect(storeId: string): string {
  if (storeId.includes("google-sheets")) {
    return "This action will move the Google Sheet to your Drive trash.";
  }
  if (storeId.includes("firestore")) {
    return "This action will move the project to the trash in Firestore for everyone.";
  }
  return "This action will delete the project from this device.";
}
