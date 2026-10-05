import { GoogleAuthService } from "@decisionator/store-google-sheets";
import type React from "react";
import { useState } from "react";
import { getGoogleConfig } from "../../config/google.js";

interface WindowWithGoogle extends Window {
  gapi?: {
    load(api: string, callback: () => void): void;
  };
  google?: {
    // biome-ignore lint/suspicious/noExplicitAny: Google client library globals
    picker?: any;
    // biome-ignore lint/suspicious/noExplicitAny: Google client library globals
    accounts?: any;
  };
}

export interface JoinFlowProps {
  fileId: string;
  onJoined: () => void;
}

export const JoinFlow: React.FC<JoinFlowProps> = ({ fileId, onJoined }) => {
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needFallback, setNeedFallback] = useState(false);

  const config = getGoogleConfig();
  const auth = new GoogleAuthService({ clientId: config.clientId });

  const handleSignIn = async (forceSelect = false) => {
    try {
      setLoading(true);
      setError(null);
      await auth.requestToken(true, forceSelect);
      const identity = await auth.getIdentity();
      setCurrentUserEmail(identity.participantId);
      await openPickerForFile(identity.participantId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const openPickerForFile = async (_userEmail: string) => {
    const token = await auth.getValidToken();
    const win = window as unknown as WindowWithGoogle;

    if (!win.gapi || !win.google?.picker) {
      // If Picker script isn't loaded in test or environment, proceed to check access
      onJoined();
      return;
    }

    const pickerLib = win.google.picker;
    win.gapi.load("picker", () => {
      try {
        const pickerBuilder = new pickerLib.PickerBuilder()
          .addView(pickerLib.ViewId.SPREADSHEETS)
          .setOAuthToken(token)
          .setDeveloperKey(config.apiKey)
          .setFileIds([fileId])
          .setTitle("Confirm access to Deci project")
          .setCallback((data: { action: string }) => {
            if (data.action === pickerLib.Action.PICKED) {
              onJoined();
            } else if (data.action === pickerLib.Action.CANCEL) {
              setLoading(false);
            }
          });

        const picker = pickerBuilder.build();
        picker.setVisible(true);
      } catch (err) {
        // Fallback recorded in R21: prompt user to open sheet URL once in Drive then confirm
        setNeedFallback(true);
        setLoading(false);
      }
    });
  };

  const handleManualConfirm = () => {
    onJoined();
  };

  return (
    <div
      className="card"
      style={{ maxWidth: 480, margin: "40px auto", textAlign: "center", padding: 24 }}
    >
      <h3 style={{ marginBottom: 12 }}>Join Decision Project</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 20 }}>
        You were invited to view or contribute to this decision. Sign in with Google to confirm read
        or write access to this Sheet.
      </p>

      {currentUserEmail && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Signed in as: <strong>{currentUserEmail}</strong>
          </span>
          <button
            type="button"
            onClick={() => handleSignIn(true)}
            className="btn btn-outline"
            style={{ fontSize: 11, padding: "2px 8px" }}
          >
            Switch account
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: "rgba(220, 38, 38, 0.1)",
            color: "var(--color-danger, #ef4444)",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {needFallback && (
        <div
          style={{
            padding: 12,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            marginBottom: 16,
            textAlign: "left",
            fontSize: 13,
          }}
        >
          <p style={{ marginBottom: 8, fontWeight: 500 }}>Access Confirmation Fallback (R21):</p>
          <p style={{ marginBottom: 12, color: "var(--text-muted)" }}>
            Google Picker could not automatically add this public sheet. Click below to view it once
            in Google Sheets (which registers it in your Drive), then click Confirm.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={`https://docs.google.com/spreadsheets/d/${fileId}/edit`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline"
              style={{ fontSize: 12 }}
            >
              Open in Google Sheets ↗
            </a>
            <button
              type="button"
              onClick={handleManualConfirm}
              className="btn btn-primary"
              style={{ fontSize: 12 }}
            >
              Confirm Access
            </button>
          </div>
        </div>
      )}

      {!currentUserEmail ? (
        <button
          type="button"
          onClick={() => handleSignIn(false)}
          className="btn btn-primary"
          disabled={loading}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {loading ? "Signing in..." : "Sign in with Google"}
        </button>
      ) : (
        !needFallback && (
          <button
            type="button"
            onClick={() => openPickerForFile(currentUserEmail)}
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? "Opening Picker..." : "Confirm Access in Google Picker"}
          </button>
        )
      )}
    </div>
  );
};
