import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { InPagePeerClient } from "@decisionator/share-inpage";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GradeInput } from "../grading/GradeInput.js";

export function PeerJoinFlow() {
  const { sessionId } = useParams();
  const [participantId] = useState(
    () => `guest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  );
  const [displayName, setDisplayName] = useState("Guest Voter");
  const [joined, setJoined] = useState(false);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [peerClient, setPeerClient] = useState<InPagePeerClient | null>(null);
  const [disconnectedReason, setDisconnectedReason] = useState<string | null>(null);

  const handleJoin = () => {
    if (!sessionId) return;
    const client = new InPagePeerClient({
      sessionId,
      participantId,
      displayName,
      onSnapshot: (snap) => setSnapshot(snap),
      onClosed: (reason) => setDisconnectedReason(reason),
    });
    client.connect();
    setPeerClient(client);
    setJoined(true);
  };

  useEffect(() => {
    return () => {
      peerClient?.disconnect();
    };
  }, [peerClient]);

  const handleGrade = (optionId: string, val: number) => {
    if (!peerClient) return;
    peerClient.submitEntries([
      {
        kind: "grade",
        optionId,
        value: val as 1 | 2 | 3 | 4 | 5,
      },
    ]);
  };

  if (disconnectedReason) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 32 }}>
        <h3>Session Disconnected</h3>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>{disconnectedReason}</p>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          The host closed their browser tab. Thank you for participating!
        </p>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="card" style={{ maxWidth: 440, margin: "40px auto", padding: 24 }}>
        <h3>Join Live Decision Session</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          Connect directly to the in-page host session: <code>{sessionId}</code>
        </p>
        <div style={{ marginTop: 16 }}>
          <label htmlFor="peer-display-name" style={{ fontSize: 12, fontWeight: 600 }}>
            Your Name
          </label>
          <input
            id="peer-display-name"
            type="text"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ width: "100%", marginTop: 4 }}
          />
        </div>
        <button
          type="button"
          onClick={handleJoin}
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 16 }}
        >
          Connect & Vote
        </button>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 32 }}>
        <h3>Connecting to host...</h3>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>
          Waiting for the host's tab to share the current project state.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 680, margin: "0 auto" }}
    >
      <div className="card">
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(16, 185, 129, 0.15)",
            color: "#10b981",
            fontWeight: 600,
          }}
        >
          CONNECTED PEER
        </span>
        <h2 style={{ margin: "8px 0 4px" }}>{snapshot.project.title}</h2>
        {snapshot.project.description && (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
            {snapshot.project.description}
          </p>
        )}
      </div>

      <div className="card">
        <h3>Cast Your Grades</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Your selections are sent directly to the host's browser tab in real time.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {snapshot.options.map((opt) => {
            const myGrade = snapshot.grades.find(
              (g) => g.by === participantId && g.optionId === opt.id
            );
            return (
              <div
                key={opt.id}
                style={{
                  padding: 12,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{opt.title}</div>
                {opt.description && (
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                    {opt.description}
                  </div>
                )}
                <GradeInput
                  value={myGrade?.value || 0}
                  onChange={(val) => handleGrade(opt.id, val)}
                  disabled={false}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
