import React from "react";
import { Link, useParams } from "react-router-dom";
import { PasswordSetup } from "../features/sharing/PasswordSetup.js";
import { ShareDialog } from "../features/sharing/ShareDialog.js";

export function HomePage() {
  return (
    <div className="card">
      <h2>Welcome to Decisionator</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Collaborative Decision Engine for Teams. Pure client-side, encrypted, with deterministic
        strategies.
      </p>
      <div style={{ marginTop: 16 }}>
        <Link to="/new" className="btn btn-primary">
          Create New Decision Project
        </Link>
      </div>
    </div>
  );
}

export function NewProjectPage() {
  return (
    <div className="card">
      <h2>Create New Decision Project</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Paste ideas, select voting format, and choose your preferred backend.
      </p>
    </div>
  );
}

export function ProjectOverviewPage() {
  const { fileId } = useParams();
  return (
    <div className="card">
      <h2>Project Overview</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Viewing project <code>{fileId}</code>
      </p>
      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link to={`/p/${fileId}/vote`} className="btn btn-primary">
          Vote
        </Link>
        <Link to={`/p/${fileId}/stats`} className="btn btn-outline">
          Stats
        </Link>
        <Link to={`/p/${fileId}/results`} className="btn btn-outline">
          Results
        </Link>
        <Link to={`/p/${fileId}/share`} className="btn btn-outline">
          Share
        </Link>
      </div>
    </div>
  );
}

export function ProjectStatsPage() {
  const { fileId } = useParams();
  return (
    <div className="card">
      <h2>Project Statistics</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Real-time metrics and grade distributions for <code>{fileId}</code>
      </p>
    </div>
  );
}

export function ProjectVotePage() {
  const { fileId } = useParams();
  return (
    <div className="card">
      <h2>Ballot / Voting</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Rank options and submit your ballot for round 1.
      </p>
    </div>
  );
}

export function ProjectResultsPage() {
  const { fileId } = useParams();
  return (
    <div className="card">
      <h2>Decision Outcome & Results</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Outcome records and tally explanations for <code>{fileId}</code>
      </p>
    </div>
  );
}

export function ProjectSharePage() {
  const { fileId } = useParams();
  const [showPasswordSetup, setShowPasswordSetup] = React.useState(false);

  if (!fileId) return <div>Project ID missing</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>Share Decision Project</h2>
            <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
              Manage link access, invite collaborators, and configure encryption for{" "}
              <code>{fileId}</code>.
            </p>
          </div>
          <Link to={`/p/${fileId}`} className="btn btn-outline" style={{ fontSize: 13 }}>
            ← Back to Project
          </Link>
        </div>
      </div>

      <ShareDialog fileId={fileId} onClose={() => {}} />

      {!showPasswordSetup ? (
        <div
          className="card"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <h4 style={{ margin: "0 0 4px 0" }}>Client-Side Encryption</h4>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
              Protect options and discussions with AES-256-GCM encryption before sending to Google
              Sheets.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswordSetup(true)}
            className="btn btn-outline"
            style={{ fontSize: 13 }}
          >
            🔒 Enable Password Protection
          </button>
        </div>
      ) : (
        <PasswordSetup
          onEnablePassword={async (_password) => {
            setShowPasswordSetup(false);
          }}
          onCancel={() => setShowPasswordSetup(false)}
        />
      )}
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="card">
      <h2>Application Settings</h2>
      <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
        Theme preferences, Google API credentials, and offline cache management.
      </p>
    </div>
  );
}
