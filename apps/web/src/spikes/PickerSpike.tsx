import React, { useCallback, useEffect, useState } from "react";

interface GooglePickerDoc {
  id: string;
  name: string;
}

interface GooglePickerCallbackData {
  action: string;
  docs: GooglePickerDoc[];
}

interface TokenClientResponse {
  access_token?: string;
  error?: string;
}

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: Google client library globals
    google?: any;
    // biome-ignore lint/suspicious/noExplicitAny: Google client library globals
    gapi?: any;
  }
}

interface LogEntry {
  id: string;
  text: string;
}

export default function PickerSpike() {
  const [clientId, setClientId] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID || "");
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GOOGLE_API_KEY || "");
  const [fileId, setFileId] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("Ready");

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toISOString().substring(11, 19);
    setLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text: `[${timestamp}] ${msg}` },
    ]);
  }, []);

  useEffect(() => {
    // Load GIS script if not present
    if (!document.getElementById("gis-script")) {
      const script = document.createElement("script");
      script.id = "gis-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }

    // Load GAPI (for Picker)
    if (!document.getElementById("gapi-script")) {
      const script = document.createElement("script");
      script.id = "gapi-script";
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.gapi?.load("picker", () => {
          addLog("Google Picker API loaded.");
        });
      };
      document.body.appendChild(script);
    }
  }, [addLog]);

  const handleSignIn = () => {
    if (!clientId) {
      alert("Please provide Google Client ID");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      alert("GIS script not loaded yet");
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (resp: TokenClientResponse) => {
        if (resp.error) {
          addLog(`Auth error: ${resp.error}`);
          setStatus(`Auth error: ${resp.error}`);
          return;
        }
        if (resp.access_token) {
          setAccessToken(resp.access_token);
          addLog("Authenticated successfully with drive.file scope.");
          setStatus("Signed in");
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  };

  const testDirectApiAccess = async (token: string, targetFileId: string) => {
    addLog(`Testing direct Drive files.get on ${targetFileId}...`);
    try {
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${targetFileId}?fields=id,name,mimeType`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (driveRes.ok) {
        const fileData = await driveRes.json();
        addLog(`✓ Drive files.get SUCCESS! Name: ${fileData.name}`);
      } else {
        const err = await driveRes.text();
        addLog(`✗ Drive files.get failed (${driveRes.status}): ${err}`);
      }

      addLog(`Testing Sheets values.get on ${targetFileId}...`);
      const sheetRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${targetFileId}/values/meta!A1:B10`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (sheetRes.ok) {
        const sheetData = await sheetRes.json();
        addLog(`✓ Sheets values.get SUCCESS! Read ${sheetData.values?.length || 0} rows.`);
        setStatus("ACCESS CONFIRMED ✓");
      } else {
        const err = await sheetRes.text();
        addLog(`✗ Sheets values.get failed (${sheetRes.status}): ${err}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`Fetch exception: ${msg}`);
    }
  };

  const handleOpenPicker = () => {
    if (!accessToken) {
      alert("Sign in first");
      return;
    }
    if (!apiKey) {
      alert("Please provide Google API Key");
      return;
    }
    if (!fileId.trim()) {
      alert("Please specify File ID of the link-shared Sheet");
      return;
    }

    if (!window.google?.picker) {
      alert("Picker library not loaded");
      return;
    }

    addLog(`Constructing Picker with setFileIds([${fileId}])...`);

    const view = new window.google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const picker = new window.google.picker.PickerBuilder()
      .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
      .setAppId(clientId.split("-")[0])
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .addView(view)
      .setFileIds([fileId.trim()])
      .setTitle("Confirm Access to Shared Project Sheet")
      .setCallback(async (data: GooglePickerCallbackData) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0];
          if (doc) {
            addLog(`✓ Picker item picked: ID=${doc.id}, Name=${doc.name}`);
            await testDirectApiAccess(accessToken, doc.id);
          }
        } else if (data.action === window.google.picker.Action.CANCEL) {
          addLog("Picker cancelled by user.");
        }
      })
      .build();

    picker.setVisible(true);
  };

  return (
    <div style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif", padding: "1rem" }}>
      <h2>T032 Spike: Google Picker setFileIds Access Test (FR-016)</h2>
      <p>
        <strong>Objective:</strong> Verify whether Google Picker <code>setFileIds([fileId])</code>{" "}
        grants the collaborator account <code>drive.file</code> access to a Sheet shared only as
        "Anyone with the link".
      </p>

      <div
        style={{ background: "#f5f5f5", padding: "1rem", borderRadius: 8, marginBottom: "1rem" }}
      >
        <div style={{ marginBottom: "0.5rem" }}>
          <label htmlFor="clientIdInput" style={{ display: "block", fontWeight: "bold" }}>
            Client ID:
          </label>
          <input
            id="clientIdInput"
            style={{ width: "100%", padding: "0.4rem" }}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Google OAuth Client ID"
          />
        </div>
        <div style={{ marginBottom: "0.5rem" }}>
          <label htmlFor="apiKeyInput" style={{ display: "block", fontWeight: "bold" }}>
            API Key (Picker enabled):
          </label>
          <input
            id="apiKeyInput"
            style={{ width: "100%", padding: "0.4rem" }}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Google API Key"
          />
        </div>
        <div style={{ marginBottom: "0.5rem" }}>
          <label htmlFor="fileIdInput" style={{ display: "block", fontWeight: "bold" }}>
            Shared Sheet File ID:
          </label>
          <input
            id="fileIdInput"
            style={{ width: "100%", padding: "0.4rem" }}
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={handleSignIn}
          style={{
            padding: "0.6rem 1.2rem",
            background: "#1a73e8",
            color: "white",
            border: "none",
            borderRadius: 4,
          }}
        >
          {accessToken ? "✓ Signed in (Token Ready)" : "1. Sign in with Collaborator Account"}
        </button>

        <button
          type="button"
          onClick={handleOpenPicker}
          disabled={!accessToken}
          style={{
            padding: "0.6rem 1.2rem",
            background: accessToken ? "#34a853" : "#ccc",
            color: "white",
            border: "none",
            borderRadius: 4,
          }}
        >
          2. Open Picker (setFileIds)
        </button>

        <button
          type="button"
          onClick={() => accessToken && testDirectApiAccess(accessToken, fileId)}
          disabled={!accessToken || !fileId}
          style={{
            padding: "0.6rem 1.2rem",
            background: "#fbbc05",
            color: "black",
            border: "none",
            borderRadius: 4,
          }}
        >
          3. Test Direct API Call
        </button>
      </div>

      {fileId && (
        <div style={{ marginBottom: "1rem", fontSize: "0.9rem" }}>
          Fallback 1 helper:{" "}
          <a
            href={`https://docs.google.com/spreadsheets/d/${fileId}/edit`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#1a73e8" }}
          >
            Open Sheet in Google First (adds to 'Shared with me')
          </a>
        </div>
      )}

      <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>Status: {status}</div>

      <div
        style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: "1rem",
          borderRadius: 4,
          fontFamily: "monospace",
          fontSize: "0.85rem",
          minHeight: 180,
          maxHeight: 350,
          overflowY: "auto",
        }}
      >
        {logs.length === 0 ? (
          <div>Logs will appear here...</div>
        ) : (
          logs.map((log) => <div key={log.id}>{log.text}</div>)
        )}
      </div>
    </div>
  );
}
