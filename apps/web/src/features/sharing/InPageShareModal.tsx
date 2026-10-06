import type { ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";
import { InPageHostServer } from "@decisionator/share-inpage";
import type React from "react";
import { useEffect, useState } from "react";

interface InPageShareModalProps {
  projectRef: ProjectRef;
  projectTitle: string;
  store: ProjectStore;
  onClose: () => void;
}

export const InPageShareModal: React.FC<InPageShareModalProps> = ({
  projectRef,
  projectTitle,
  store,
  onClose,
}) => {
  const [sessionId] = useState(
    () => `p2p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  );
  const [hostServer, setHostServer] = useState<InPageHostServer | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const server = new InPageHostServer({
      sessionId,
      projectRef,
      store,
      onPeerCountChange: (cnt) => setPeerCount(cnt),
    });
    setHostServer(server);

    return () => {
      server.close("Session ended by host");
    };
  }, [sessionId, projectRef, store]);

  const joinUrl = `${window.location.origin}${window.location.pathname}#/join/${sessionId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
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
        className="card"
        style={{
          background: "var(--bg, #fff)",
          padding: 24,
          borderRadius: 10,
          maxWidth: 480,
          width: "90%",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0 }}>📡 In-Page Live Session</h3>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Your browser tab is hosting this live voting session directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline"
            style={{ padding: "4px 8px" }}
          >
            ✕
          </button>
        </div>

        {/* Live status badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderRadius: 6,
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#10b981",
                boxShadow: "0 0 8px #10b981",
              }}
            />
            <strong style={{ fontSize: 13, color: "#065f46" }}>Live Host Active</strong>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#065f46" }}>
            👥 Connected Peers: {peerCount}
          </span>
        </div>

        {/* Share Link */}
        <div>
          <label
            htmlFor="join-link-input"
            style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}
          >
            Temporary Direct Join Link
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <input
              id="join-link-input"
              type="text"
              readOnly
              value={joinUrl}
              className="input"
              style={{ width: "100%", fontSize: 12 }}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="btn btn-primary"
              style={{ whiteSpace: "nowrap" }}
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          ℹ️ Collaborators connecting with this link will stream votes and grades directly into this
          open browser tab. When you close this tab, the live session will end.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-outline">
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
};
