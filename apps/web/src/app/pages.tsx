import { runTally } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { GoogleAuthService, GoogleSheetsProjectStore } from "@decisionator/store-google-sheets";
import { bordaStrategy } from "@decisionator/strategy-borda";
import React from "react";
import { Link, useParams } from "react-router-dom";
import { getGoogleConfig } from "../config/google.js";
import { StrategyChooser } from "../features/decide/StrategyChooser.js";
import { useRole } from "../features/project/useRole.js";
import { PasswordSetup } from "../features/sharing/PasswordSetup.js";
import { ShareDialog } from "../features/sharing/ShareDialog.js";
import { RankBallot } from "../features/voting/RankBallot.js";
import { ResultsView } from "../features/voting/ResultsView.js";
import { VotingControls } from "../features/voting/VotingControls.js";

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
  const [snapshot, setSnapshot] = React.useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [currentUser, setCurrentUser] = React.useState("");

  React.useEffect(() => {
    if (!fileId) return;
    async function load() {
      try {
        setLoading(true);
        const cfg = getGoogleConfig();
        const auth = new GoogleAuthService({ clientId: cfg.clientId });
        const store = new GoogleSheetsProjectStore(auth);
        const identity = await store.signIn({ interactive: false });
        setCurrentUser(identity.participantId);
        const validFileId = fileId as string;
        const snap = await store.openProject({ store: "google-sheets", id: validFileId });
        setSnapshot(snap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fileId]);

  if (!fileId || loading || !snapshot) {
    return <div className="card">Loading voting...</div>;
  }

  const roleCaps = useRole(snapshot.role);
  const currentRound = snapshot.project.voting?.round ?? 1;
  const topN = snapshot.project.voting?.topN ?? 3;
  const isOwner = snapshot.role === "owner";

  const myBallot = snapshot.rankings.find(
    (r) => r.by === currentUser && (r.round ?? 1) === currentRound
  );

  const handleSubmitBallot = async (ranking: string[]) => {
    const cfg = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: cfg.clientId });
    const store = new GoogleSheetsProjectStore(auth);
    await store.append({ store: "google-sheets", id: fileId }, [
      { kind: "ranking", ranking, round: currentRound },
    ]);
    const updated = await store.openProject({ store: "google-sheets", id: fileId });
    setSnapshot(updated);
  };

  const handleUpdateVoting = async (voting: NonNullable<ProjectSnapshot["project"]["voting"]>) => {
    const cfg = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: cfg.clientId });
    const store = new GoogleSheetsProjectStore(auth);
    await store.updateMeta({ store: "google-sheets", id: fileId }, { voting });
    const updated = await store.openProject({ store: "google-sheets", id: fileId });
    setSnapshot(updated);
  };

  const handleCloseAndTally = async () => {
    const cfg = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: cfg.clientId });
    const store = new GoogleSheetsProjectStore(auth);

    // Run tally
    const outcome = await runTally({
      snapshot,
      strategy: bordaStrategy,
      strategyId: "org.decisionator.strategy.borda",
      strategyVersion: "0.1.0",
      triggeredBy: currentUser,
    });

    // Close voting state
    const nextVoting = {
      ...(snapshot.project.voting ?? {
        state: "open" as const,
        round: 1,
        topN: 3,
        liveResults: true,
      }),
      state: "closed" as const,
    };

    await store.updateMeta({ store: "google-sheets", id: fileId }, { voting: nextVoting });
    await store.append({ store: "google-sheets", id: fileId }, [{ kind: "outcome", outcome }]);

    const updated = await store.openProject({ store: "google-sheets", id: fileId });
    setSnapshot(updated);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0" }}>Ballot / Voting</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
              {snapshot.project.title} — Round {currentRound}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link to={`/p/${fileId}/results`} className="btn btn-outline" style={{ fontSize: 12 }}>
              Results
            </Link>
            <Link to={`/p/${fileId}`} className="btn btn-outline" style={{ fontSize: 12 }}>
              ← Project
            </Link>
          </div>
        </div>
      </div>

      {isOwner && (
        <VotingControls
          voting={snapshot.project.voting}
          onUpdateVoting={handleUpdateVoting}
          onCloseAndTally={handleCloseAndTally}
        />
      )}

      <RankBallot
        options={snapshot.options}
        topN={topN}
        initialRanking={myBallot?.ranking}
        disabled={!roleCaps.canVote || snapshot.project.voting?.state === "closed"}
        disabledReason={
          snapshot.project.voting?.state === "closed"
            ? "Voting is currently closed for this round."
            : roleCaps.disabledReason
        }
        onSubmitBallot={handleSubmitBallot}
      />
    </div>
  );
}

export function ProjectResultsPage() {
  const { fileId } = useParams();
  const [snapshot, setSnapshot] = React.useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!fileId) return;
    async function load() {
      try {
        setLoading(true);
        const cfg = getGoogleConfig();
        const auth = new GoogleAuthService({ clientId: cfg.clientId });
        const store = new GoogleSheetsProjectStore(auth);
        const validFileId = fileId as string;
        const snap = await store.openProject({ store: "google-sheets", id: validFileId });
        setSnapshot(snap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fileId]);

  if (!fileId || loading || !snapshot) {
    return <div className="card">Loading results...</div>;
  }

  const currentRound = snapshot.project.voting?.round ?? 1;
  const liveResults = snapshot.project.voting?.liveResults ?? true;
  const isOpen = snapshot.project.voting?.state === "open";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0" }}>Decision Outcome & Results</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
              {snapshot.project.title}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link to={`/p/${fileId}/vote`} className="btn btn-outline" style={{ fontSize: 12 }}>
              Ballot
            </Link>
            <Link to={`/p/${fileId}`} className="btn btn-outline" style={{ fontSize: 12 }}>
              ← Project
            </Link>
          </div>
        </div>
      </div>

      <ResultsView
        outcomes={snapshot.outcomes}
        options={snapshot.options}
        rankings={snapshot.rankings}
        currentRound={currentRound}
        liveResults={liveResults}
        isOpen={isOpen}
      />

      {snapshot.role === "owner" && (
        <StrategyChooser
          snapshot={snapshot}
          fileId={fileId}
          currentUser={snapshot.project.title}
          isOwner={true}
          onOutcomeCreated={(newOutcome) => {
            setSnapshot({
              ...snapshot,
              outcomes: [newOutcome, ...snapshot.outcomes],
            });
          }}
        />
      )}
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

import { StorageSettings } from "../features/settings/StorageSettings.js";

export function SettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <h2>Application Settings</h2>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
          Storage provider settings, active persistence target, and credentials management.
        </p>
      </div>
      <StorageSettings />
    </div>
  );
}
