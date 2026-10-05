import type { ProjectSummary } from "@decisionator/plugin-sdk";
import { GoogleAuthService, GoogleSheetsProjectStore } from "@decisionator/store-google-sheets";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getGoogleConfig } from "../config/google.js";
import { getDatabase } from "../sync/db.js";

export function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const config = getGoogleConfig();
        const auth = new GoogleAuthService({ clientId: config.clientId });
        const store = new GoogleSheetsProjectStore(auth);

        // Check if token exists
        const token = await auth.getValidToken();
        if (token) {
          setSignedIn(true);
          const list = await store.listProjects();
          setProjects(list);
          return;
        }

        // If not signed in to Google, load offline cached projects from IndexedDB
        const db = await getDatabase();
        const cachedSnapshots = await db.getAll("snapshots");
        if (cachedSnapshots.length > 0) {
          setProjects(
            cachedSnapshots.map((s) => ({
              ref: { store: "google-sheets", id: s.projectRefId.replace(/^google-sheets:/, "") },
              title: s.snapshot.project.title,
              owner: "",
              updatedAt: s.cachedAt,
            }))
          );
        }
      } catch {
        // Fallback gracefully
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <h2>My Decision Projects</h2>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
          Collaborative Decision Engine for Teams. Pure client-side, encrypted, with deterministic
          strategies.
        </p>
        <div style={{ marginTop: 16 }}>
          <Link to="/new" className="btn btn-primary">
            + New Decision Project
          </Link>
        </div>
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
            {projects.map((p) => (
              <div
                key={p.ref.id}
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
                  <strong>{p.title}</strong>
                  {p.updatedAt && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Opened: {new Date(p.updatedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <Link to={`/p/${p.ref.id}`} className="btn btn-outline" style={{ fontSize: 12 }}>
                  Open &rarr;
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
