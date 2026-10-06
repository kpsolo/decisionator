import type { ProjectRef, ProjectStore, ShareState } from "@decisionator/plugin-sdk";
import { Copy, Globe, Users } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { toast } from "../../components/ui/use-toast.js";

export interface ShareDialogProps {
  store: ProjectStore;
  projectRef: ProjectRef;
  onClose: () => void;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ store, projectRef, onClose }) => {
  const [shareState, setShareState] = useState<ShareState | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"contribute" | "view">("contribute");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const state = await store.getShareState(projectRef);
        setShareState(state);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [store, projectRef]);

  const handleCopyLink = async () => {
    if (!shareState?.linkSharing.url) return;
    try {
      await navigator.clipboard.writeText(shareState.linkSharing.url);
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
      title: "Link copied!",
      description: "Shareable project link copied to clipboard.",
      variant: "success",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleLinkSharing = async (enabled: boolean) => {
    try {
      setLoading(true);
      const updated = await store.share(projectRef, {
        linkSharing: {
          enabled,
          role: shareState?.linkSharing.role ?? "contribute",
        },
      });
      setShareState(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleChangeLinkRole = async (newRole: "contribute" | "view") => {
    try {
      setLoading(true);
      const updated = await store.share(projectRef, {
        linkSharing: {
          enabled: true,
          role: newRole,
        },
      });
      setShareState(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      setLoading(true);
      const updated = await store.share(projectRef, {
        inviteUsers: [{ email: inviteEmail.trim(), role: inviteRole }],
      });
      setShareState(updated);
      setInviteEmail("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" aria-hidden />
            <span>Share Decision Project</span>
          </DialogTitle>
          <DialogDescription>
            Manage collaborator access and link sharing options for this project.
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

        {loading && !shareState ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading sharing settings...
          </p>
        ) : (
          <div className="space-y-4">
            {/* Link Sharing Section */}
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" aria-hidden />
                  <strong className="text-sm font-semibold text-foreground">Link Sharing</strong>
                </div>
                <label className="flex cursor-pointer select-none items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={shareState?.linkSharing.enabled}
                    onChange={(e) => handleToggleLinkSharing(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                  />
                  <span className="font-medium">
                    {shareState?.linkSharing.enabled ? "Enabled" : "Off"}
                  </span>
                </label>
              </div>

              {shareState?.linkSharing.enabled && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      readOnly
                      aria-label="Shareable project link"
                      value={shareState.linkSharing.url}
                      className="h-8 bg-background font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleCopyLink}
                      leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden />}
                      className="h-8 shrink-0 text-xs"
                    >
                      {copied ? "Copied!" : "Copy Link"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Access level:</span>
                    <NativeSelect
                      aria-label="Link sharing access level"
                      value={shareState.linkSharing.role}
                      onChange={(e) =>
                        handleChangeLinkRole(e.target.value as "contribute" | "view")
                      }
                      wrapperClassName="min-w-0 flex-1"
                      className="h-8 text-xs sm:text-xs"
                    >
                      <option value="contribute">
                        Anyone with link can Contribute (Grade, Comment, Vote)
                      </option>
                      <option value="view">Anyone with link can View Only</option>
                    </NativeSelect>
                  </div>
                </div>
              )}
            </div>

            {/* Email Invite Section */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3.5">
              <strong className="block text-sm font-semibold text-foreground">
                Invite by Email
              </strong>
              <form onSubmit={handleInvite} className="flex items-center gap-2">
                <Input
                  type="email"
                  aria-label="Invite email address"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="h-9 text-xs"
                />
                <NativeSelect
                  aria-label="Invite role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "contribute" | "view")}
                  className="h-9 text-xs sm:text-xs"
                >
                  <option value="contribute">Contribute</option>
                  <option value="view">View</option>
                </NativeSelect>
                <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0 text-xs">
                  Invite
                </Button>
              </form>
              <p className="m-0 text-[11px] text-muted-foreground">
                Note: Only collaborators invited by email can be removed individually.
              </p>
            </div>

            {/* Collaborators List */}
            {shareState && shareState.collaborators.length > 0 && (
              <div className="space-y-2 pt-1">
                <strong className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Collaborators ({shareState.collaborators.length})
                </strong>
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {shareState.collaborators.map((c) => (
                    <div
                      key={c.email}
                      className="flex items-center justify-between rounded-md border border-border bg-card/60 p-2 text-xs"
                    >
                      <span className="truncate font-medium">{c.email}</span>
                      <Badge variant="outline" className="py-0 text-[10px]">
                        {c.role}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShareDialog;
