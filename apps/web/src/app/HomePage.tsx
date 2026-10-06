import { ProjectExportV1Schema } from "@decisionator/core";
import type { ProjectSummary } from "@decisionator/plugin-sdk";
import type { FileProjectStore } from "@decisionator/store-file";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getStorageManager } from "../storage/storage-manager.js";
import { getDatabase } from "../sync/db.js";

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        setLoading(true);
        const sm = getStorageManager();
        const all = await sm.listAllProjects();

        // Also check offline cached projects in IndexedDB if any
        const db = await getDatabase();
        const cachedSnapshots = await db.getAll("snapshots");
        const cachedSummaries: ProjectSummary[] = cachedSnapshots
          .filter((s) => !all.some((p) => p.ref.id === s.projectRefId.replace(/^[a-z-]+:/, "")))
          .map((s) => ({
            ref: {
              store: s.projectRefId.startsWith("file:") ? "file" : "google-sheets",
              id: s.projectRefId.replace(/^[a-z-]+:/, ""),
            },
            title: s.snapshot.project.title,
            owner: "",
            updatedAt: s.cachedAt,
          }));

        setProjects([...all, ...cachedSummaries]);
      } catch {
        // Fallback gracefully
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, []);

  const handleOpenJsonContent = async (jsonText: string, fileHandle?: FileSystemFileHandle) => {
    try {
      setError(null);
      const parsed = JSON.parse(jsonText);
      const validated = ProjectExportV1Schema.parse(parsed);

      const sm = getStorageManager();
      const fileStore = (sm.getStore("file") ||
        sm.getStore("org.decisionator.store.file")) as FileProjectStore;

      const ref = await fileStore.createProject({
        title: validated.project.title,
        description: validated.project.description,
        options: validated.options,
        voting: validated.project.voting,
      });

      if (fileHandle) {
        fileStore.setFileHandle(ref.id, fileHandle);
      }

      // Restore votes, comments, outcomes
      const entries: Parameters<typeof fileStore.append>[1] = [];
      for (const g of validated.grades) {
        entries.push({ kind: "grade", optionId: g.optionId, value: g.value });
      }
      for (const c of validated.comments) {
        entries.push({ kind: "comment", optionId: c.optionId, body: c.body });
      }
      for (const r of validated.rankings) {
        entries.push({ kind: "ranking", ranking: r.ranking, round: r.round });
      }
      for (const o of validated.outcomes) {
        entries.push({ kind: "outcome", outcome: o });
      }
      if (entries.length > 0) {
        await fileStore.append(ref, entries);
      }

      navigate(`/p/file/${ref.id}`);
    } catch (err: unknown) {
      setError(`Failed to open decision file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenFilePicker = async () => {
    try {
      if ("showOpenFilePicker" in window) {
        const [handle] = await (
          window as unknown as {
            showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandle[]>;
          }
        ).showOpenFilePicker({
          types: [
            {
              description: "Deci Project Files (*.decisionator.json, *.json)",
              accept: { "application/json": [".json", ".decisionator.json"] },
            },
          ],
        });
        if (handle) {
          const file = await handle.getFile();
          const text = await file.text();
          await handleOpenJsonContent(text, handle);
          return;
        }
      }
    } catch {
      // User cancelled or unsupported
    }
    // Fallback to standard file input
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      await handleOpenJsonContent(text);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const text = await file.text();
      await handleOpenJsonContent(text);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "rgba(220, 38, 38, 0.1)",
            color: "var(--color-danger, #ef4444)",
          }}
        >
          {error}
        </div>
      )}

      <div className="card">
        <h2>My Decision Projects</h2>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
          Modular Decision Engine for Teams. Runs locally in your browser, saves to your active
          storage, and works 100% offline with local files.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/new" className="btn btn-primary">
            + New Decision Project
          </Link>
          <button type="button" onClick={handleOpenFilePicker} className="btn btn-outline">
            📁 Open from File...
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept=".json,.decisionator.json"
            style={{ display: "none" }}
          />
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragActive ? "var(--color-primary, #3b82f6)" : "var(--border)"}`,
          borderRadius: 8,
          padding: "20px 16px",
          textAlign: "center",
          background: dragActive ? "rgba(59, 130, 246, 0.05)" : "transparent",
          transition: "all 0.2s ease",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        💡 Tip: Drag and drop any <code>.decisionator.json</code> file here to open it immediately.
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: "center", padding: 24 }}>
          Loading your projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
            No decision projects found yet.
          </p>
          <Link to="/new" className="btn btn-outline">
            Create your first decision project
          </Link>
        </div>
      ) : (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Recent Projects ({projects.length})</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {projects.map((p) => {
              const storePrefix = p.ref.store || "file";
              const openUrl = `/p/${storePrefix}/${p.ref.id}`;
              return (
                <div
                  key={`${storePrefix}:${p.ref.id}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>{p.title}</strong>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background:
                            storePrefix === "file"
                              ? "rgba(16, 185, 129, 0.15)"
                              : storePrefix === "firestore"
                                ? "rgba(245, 158, 11, 0.15)"
                                : "rgba(59, 130, 246, 0.15)",
                          color:
                            storePrefix === "file"
                              ? "#10b981"
                              : storePrefix === "firestore"
                                ? "#f59e0b"
                                : "#3b82f6",
                          textTransform: "uppercase",
                          fontWeight: 600,
                        }}
                      >
                        {storePrefix}
                      </span>
                    </div>
                    {p.updatedAt && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        Updated: {new Date(p.updatedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <Link to={openUrl} className="btn btn-outline" style={{ fontSize: 12 }}>
                    Open &rarr;
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
