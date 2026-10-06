import { type ProjectExportV1, ProjectExportV1Schema } from "@decisionator/core";
import type { ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import type React from "react";
import { useState } from "react";

export interface MoveProjectProps {
  currentStore: ProjectStore;
  targetStore: ProjectStore;
  currentSnapshot?: ProjectSnapshot;
  onMoved?: (newRef: { store: string; id: string }) => void;
}

export const MoveProject: React.FC<MoveProjectProps> = ({
  currentStore,
  targetStore,
  currentSnapshot,
  onMoved,
}) => {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileInputJson, setFileInputJson] = useState<string>("");

  const handleExportToFile = () => {
    if (!currentSnapshot) return;
    const bundle: ProjectExportV1 = {
      format: "decisionator.project/v1",
      exportedAt: new Date().toISOString(),
      project: currentSnapshot.project,
      options: currentSnapshot.options,
      grades: currentSnapshot.grades,
      comments: currentSnapshot.comments,
      rankings: currentSnapshot.rankings,
      outcomes: currentSnapshot.outcomes,
    };

    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSnapshot.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.decisionator.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (jsonString: string) => {
    try {
      setMoving(true);
      setError(null);
      const parsed = JSON.parse(jsonString);
      const validated = ProjectExportV1Schema.parse(parsed);

      const newRef = await targetStore.createProject({
        title: validated.project.title,
        description: validated.project.description,
        voting: validated.project.voting,
        options: validated.options,
      });

      // Append entries
      const entriesToAppend = [
        ...validated.grades.map((g) => ({
          kind: "grade" as const,
          optionId: g.optionId,
          value: g.value,
        })),
        ...validated.comments.map((c) => ({
          kind: "comment" as const,
          optionId: c.optionId,
          body: c.body,
          hidden: c.hidden,
        })),
        ...validated.rankings.map((r) => ({
          kind: "ranking" as const,
          ranking: r.ranking,
          round: r.round,
        })),
        ...validated.outcomes.map((o) => ({
          kind: "outcome" as const,
          outcome: o,
        })),
      ];

      if (entriesToAppend.length > 0) {
        await targetStore.append(newRef, entriesToAppend);
      }

      setSuccess(`Project migrated to ${targetStore.id} successfully!`);
      if (onMoved) {
        onMoved(newRef);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import project");
    } finally {
      setMoving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileInputJson(text);
    };
    reader.readAsText(file);
  };

  const handleDirectTransfer = async () => {
    if (!currentSnapshot) return;
    try {
      setMoving(true);
      setError(null);

      const newRef = await targetStore.createProject({
        title: currentSnapshot.project.title,
        description: currentSnapshot.project.description,
        voting: currentSnapshot.project.voting,
        options: currentSnapshot.options,
      });

      const entries = [
        ...currentSnapshot.grades.map((g) => ({
          kind: "grade" as const,
          optionId: g.optionId,
          value: g.value,
        })),
        ...currentSnapshot.comments.map((c) => ({
          kind: "comment" as const,
          optionId: c.optionId,
          body: c.body,
          hidden: c.hidden,
        })),
        ...currentSnapshot.rankings.map((r) => ({
          kind: "ranking" as const,
          ranking: r.ranking,
          round: r.round,
        })),
        ...currentSnapshot.outcomes.map((o) => ({
          kind: "outcome" as const,
          outcome: o,
        })),
      ];

      if (entries.length > 0) {
        await targetStore.append(newRef, entries);
      }

      setSuccess(`Project transferred directly from ${currentStore.id} to ${targetStore.id}`);
      if (onMoved) {
        onMoved(newRef);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Direct transfer failed");
    } finally {
      setMoving(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-outline"
        style={{ fontSize: 13 }}
      >
        Move / Export Project
      </button>

      {open && (
        <dialog
          open
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            border: "none",
            width: "100%",
            height: "100%",
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              borderRadius: 8,
              maxWidth: 520,
              width: "90%",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Move / Migrate Project (FR-072)</h3>
            <p style={{ fontSize: 14, color: "#666" }}>
              Migrate decisions seamlessly between Google Sheets and Local-First mode using standard{" "}
              <code>decisionator.project/v1</code> bundles.
            </p>

            {error && (
              <div
                role="alert"
                style={{
                  padding: 10,
                  background: "#ffebee",
                  color: "#c62828",
                  borderRadius: 4,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            {success && (
              <output
                style={{
                  display: "block",
                  padding: 10,
                  background: "#e8f5e9",
                  color: "#2e7d32",
                  borderRadius: 4,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                {success}
              </output>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {currentSnapshot && (
                <div style={{ padding: 12, border: "1px solid #e0e0e0", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Option A: Direct Transfer</div>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
                    Copy project state directly to {targetStore.id}.
                  </div>
                  <button
                    type="button"
                    onClick={handleDirectTransfer}
                    disabled={moving}
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                  >
                    {moving ? "Transferring..." : `Transfer to ${targetStore.id}`}
                  </button>
                </div>
              )}

              {currentSnapshot && (
                <div style={{ padding: 12, border: "1px solid #e0e0e0", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Option B: Export to File</div>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
                    Download <code>decisionator.project/v1</code> JSON file for backup or import
                    elsewhere.
                  </div>
                  <button
                    type="button"
                    onClick={handleExportToFile}
                    className="btn btn-outline"
                    style={{ fontSize: 13 }}
                  >
                    Download JSON Bundle
                  </button>
                </div>
              )}

              <div style={{ padding: 12, border: "1px solid #e0e0e0", borderRadius: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Option C: Import from File</div>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
                  Import a <code>decisionator.project/v1</code> JSON bundle into {targetStore.id}.
                </div>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  style={{ fontSize: 13, marginBottom: 8 }}
                />
                {fileInputJson && (
                  <button
                    type="button"
                    onClick={() => handleImportJson(fileInputJson)}
                    disabled={moving}
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                  >
                    {moving ? "Importing..." : "Execute Import"}
                  </button>
                )}
              </div>
            </div>

            <div style={{ marginTop: 20, textAlign: "right" }}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setSuccess(null);
                }}
                className="btn btn-outline"
                style={{ fontSize: 13 }}
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
};
