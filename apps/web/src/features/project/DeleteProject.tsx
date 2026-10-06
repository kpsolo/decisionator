import type React from "react";
import { useState } from "react";
import { getDatabase } from "../../sync/db.js";

export interface DeleteProjectProps {
  fileId: string;
  projectTitle: string;
  isOwner: boolean;
  onDeleted: () => void;
}

export const DeleteProject: React.FC<DeleteProjectProps> = ({
  fileId,
  projectTitle,
  isOwner,
  onDeleted,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async () => {
    try {
      setLoading(true);
      setError(null);

      // Clean local IndexedDB state
      const db = await getDatabase();
      await db.delete("snapshots", `google-sheets:${fileId}`);

      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="btn btn-outline"
        style={{ color: "var(--color-danger, #ef4444)", fontSize: 13 }}
      >
        {isOwner ? "Delete Project..." : "Remove from my list"}
      </button>
    );
  }

  return (
    <dialog
      open
      aria-labelledby="delete-dialog-title"
      style={{
        border: "1px solid var(--color-danger, #ef4444)",
        borderRadius: 8,
        padding: 16,
        background: "var(--card-bg)",
        marginTop: 12,
      }}
    >
      <h4
        id="delete-dialog-title"
        style={{ margin: "0 0 8px 0", color: "var(--color-danger, #ef4444)" }}
      >
        {isOwner ? "Delete Decision Project" : "Remove Project"}
      </h4>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0" }}>
        {isOwner
          ? `This action will move the Google Sheet to your Drive trash. To confirm, type the project name "${projectTitle}" below:`
          : "This will remove the project from your local list. You can re-open it anytime via the link."}
      </p>

      {error && (
        <div
          role="alert"
          style={{ color: "var(--color-danger, #ef4444)", fontSize: 13, marginBottom: 8 }}
        >
          {error}
        </div>
      )}

      {isOwner && (
        <input
          type="text"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          placeholder={projectTitle}
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            boxSizing: "border-box",
            marginBottom: 12,
            fontSize: 13,
          }}
        />
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setConfirmInput("");
          }}
          className="btn btn-outline"
          style={{ fontSize: 12 }}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAction}
          className="btn btn-primary"
          style={{
            background: "var(--color-danger, #ef4444)",
            borderColor: "var(--color-danger, #ef4444)",
            fontSize: 12,
          }}
          disabled={loading || (isOwner && confirmInput !== projectTitle)}
        >
          {loading ? "Processing..." : isOwner ? "Permanently Delete" : "Remove"}
        </button>
      </div>
    </dialog>
  );
};
