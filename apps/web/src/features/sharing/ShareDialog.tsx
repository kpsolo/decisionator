import type { ShareState } from "@decisionator/plugin-sdk";
import {
  GoogleAuthService,
  GoogleSheetsProjectStore,
  getProjectShareState,
  removeProjectCollaborator,
  updateProjectSharing,
} from "@decisionator/store-google-sheets";
import type React from "react";
import { useEffect, useState } from "react";
import { getGoogleConfig } from "../../config/google.js";

export interface ShareDialogProps {
  fileId: string;
  onClose: () => void;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ fileId, onClose }) => {
  const [shareState, setShareState] = useState<ShareState | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"contribute" | "view">("contribute");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getStore = () => {
    const cfg = getGoogleConfig();
    const googleAuth = new GoogleAuthService({ clientId: cfg.clientId });
    return new GoogleSheetsProjectStore(googleAuth);
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const cfg = getGoogleConfig();
        const googleAuth = new GoogleAuthService({ clientId: cfg.clientId });
        const projectStore = new GoogleSheetsProjectStore(googleAuth);
        const state = await projectStore.getShareState({ store: "google-sheets", id: fileId });
        setShareState(state);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fileId]);

  const handleCopyLink = async () => {
    if (!shareState?.linkSharing.url) return;
    await navigator.clipboard.writeText(shareState.linkSharing.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleLinkSharing = async (enabled: boolean) => {
    try {
      setLoading(true);
      const store = getStore();
      const updated = await store.share(
        { store: "google-sheets", id: fileId },
        {
          linkSharing: {
            enabled,
            role: shareState?.linkSharing.role ?? "contribute",
          },
        }
      );
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
      const store = getStore();
      const updated = await store.share(
        { store: "google-sheets", id: fileId },
        {
          linkSharing: {
            enabled: true,
            role: newRole,
          },
        }
      );
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
      const store = getStore();
      const updated = await store.share(
        { store: "google-sheets", id: fileId },
        {
          inviteUsers: [{ email: inviteEmail.trim(), role: inviteRole }],
        }
      );
      setShareState(updated);
      setInviteEmail("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog
      open
      aria-labelledby="share-dialog-title"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 20,
        background: "var(--card-bg)",
        color: "var(--text)",
        maxWidth: 520,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h3 id="share-dialog-title" style={{ margin: 0 }}>
          Share Decision Project
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-outline"
          style={{ padding: "2px 8px" }}
        >
          ✕
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{ color: "var(--color-danger, #ef4444)", fontSize: 13, marginBottom: 12 }}
        >
          {error}
        </div>
      )}

      {loading && !shareState ? (
        <p style={{ color: "var(--text-muted)" }}>Loading sharing settings...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Link Sharing Section */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              background: "var(--bg)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <strong>Link Sharing</strong>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={shareState?.linkSharing.enabled}
                  onChange={(e) => handleToggleLinkSharing(e.target.checked)}
                />
                {shareState?.linkSharing.enabled ? "Enabled" : "Off"}
              </label>
            </div>

            {shareState?.linkSharing.enabled && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    readOnly
                    value={shareState.linkSharing.url}
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--card-bg)",
                      color: "var(--text)",
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="btn btn-primary"
                    style={{ fontSize: 12 }}
                  >
                    {copied ? "Copied!" : "Copy Link"}
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  <span>Access level:</span>
                  <select
                    value={shareState.linkSharing.role}
                    onChange={(e) => handleChangeLinkRole(e.target.value as "contribute" | "view")}
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                    }}
                  >
                    <option value="contribute">
                      Anyone with link can Contribute (Grade, Comment, Vote)
                    </option>
                    <option value="view">Anyone with link can View Only</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Email Invite Section */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              background: "var(--bg)",
            }}
          >
            <strong style={{ display: "block", marginBottom: 8 }}>Invite by Email</strong>
            <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "var(--card-bg)",
                  color: "var(--text)",
                  fontSize: 13,
                }}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "contribute" | "view")}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "var(--card-bg)",
                  color: "var(--text)",
                  fontSize: 12,
                }}
              >
                <option value="contribute">Contribute</option>
                <option value="view">View</option>
              </select>
              <button type="submit" className="btn btn-outline" style={{ fontSize: 12 }}>
                Invite
              </button>
            </form>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              Note: Only collaborators invited by email can be removed individually.
            </p>
          </div>

          {/* Collaborators List */}
          {shareState && shareState.collaborators.length > 0 && (
            <div>
              <strong style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
                Collaborators ({shareState.collaborators.length})
              </strong>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {shareState.collaborators.map((c) => (
                  <div
                    key={c.email}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: "var(--bg)",
                    }}
                  >
                    <span>{c.email}</span>
                    <span style={{ color: "var(--text-muted)" }}>{c.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
};
