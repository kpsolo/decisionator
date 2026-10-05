import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useCallback, useEffect, useState } from "react";
export default function PickerSpike() {
    const [clientId, setClientId] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID || "");
    const [apiKey, setApiKey] = useState(import.meta.env.VITE_GOOGLE_API_KEY || "");
    const [fileId, setFileId] = useState("");
    const [accessToken, setAccessToken] = useState(null);
    const [logs, setLogs] = useState([]);
    const [status, setStatus] = useState("Ready");
    const addLog = useCallback((msg) => {
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
            callback: (resp) => {
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
    const testDirectApiAccess = async (token, targetFileId) => {
        addLog(`Testing direct Drive files.get on ${targetFileId}...`);
        try {
            const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFileId}?fields=id,name,mimeType`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (driveRes.ok) {
                const fileData = await driveRes.json();
                addLog(`✓ Drive files.get SUCCESS! Name: ${fileData.name}`);
            }
            else {
                const err = await driveRes.text();
                addLog(`✗ Drive files.get failed (${driveRes.status}): ${err}`);
            }
            addLog(`Testing Sheets values.get on ${targetFileId}...`);
            const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetFileId}/values/meta!A1:B10`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (sheetRes.ok) {
                const sheetData = await sheetRes.json();
                addLog(`✓ Sheets values.get SUCCESS! Read ${sheetData.values?.length || 0} rows.`);
                setStatus("ACCESS CONFIRMED ✓");
            }
            else {
                const err = await sheetRes.text();
                addLog(`✗ Sheets values.get failed (${sheetRes.status}): ${err}`);
            }
        }
        catch (e) {
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
            .setCallback(async (data) => {
            if (data.action === window.google.picker.Action.PICKED) {
                const doc = data.docs[0];
                if (doc) {
                    addLog(`✓ Picker item picked: ID=${doc.id}, Name=${doc.name}`);
                    await testDirectApiAccess(accessToken, doc.id);
                }
            }
            else if (data.action === window.google.picker.Action.CANCEL) {
                addLog("Picker cancelled by user.");
            }
        })
            .build();
        picker.setVisible(true);
    };
    return (_jsxs("div", { style: { maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif", padding: "1rem" }, children: [_jsx("h2", { children: "T032 Spike: Google Picker setFileIds Access Test (FR-016)" }), _jsxs("p", { children: [_jsx("strong", { children: "Objective:" }), " Verify whether Google Picker ", _jsx("code", { children: "setFileIds([fileId])" }), " ", "grants the collaborator account ", _jsx("code", { children: "drive.file" }), " access to a Sheet shared only as \"Anyone with the link\"."] }), _jsxs("div", { style: { background: "#f5f5f5", padding: "1rem", borderRadius: 8, marginBottom: "1rem" }, children: [_jsxs("div", { style: { marginBottom: "0.5rem" }, children: [_jsx("label", { htmlFor: "clientIdInput", style: { display: "block", fontWeight: "bold" }, children: "Client ID:" }), _jsx("input", { id: "clientIdInput", style: { width: "100%", padding: "0.4rem" }, value: clientId, onChange: (e) => setClientId(e.target.value), placeholder: "Google OAuth Client ID" })] }), _jsxs("div", { style: { marginBottom: "0.5rem" }, children: [_jsx("label", { htmlFor: "apiKeyInput", style: { display: "block", fontWeight: "bold" }, children: "API Key (Picker enabled):" }), _jsx("input", { id: "apiKeyInput", style: { width: "100%", padding: "0.4rem" }, value: apiKey, onChange: (e) => setApiKey(e.target.value), placeholder: "Google API Key" })] }), _jsxs("div", { style: { marginBottom: "0.5rem" }, children: [_jsx("label", { htmlFor: "fileIdInput", style: { display: "block", fontWeight: "bold" }, children: "Shared Sheet File ID:" }), _jsx("input", { id: "fileIdInput", style: { width: "100%", padding: "0.4rem" }, value: fileId, onChange: (e) => setFileId(e.target.value), placeholder: "e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" })] })] }), _jsxs("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "1rem" }, children: [_jsx("button", { type: "button", onClick: handleSignIn, style: {
                            padding: "0.6rem 1.2rem",
                            background: "#1a73e8",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                        }, children: accessToken ? "✓ Signed in (Token Ready)" : "1. Sign in with Collaborator Account" }), _jsx("button", { type: "button", onClick: handleOpenPicker, disabled: !accessToken, style: {
                            padding: "0.6rem 1.2rem",
                            background: accessToken ? "#34a853" : "#ccc",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                        }, children: "2. Open Picker (setFileIds)" }), _jsx("button", { type: "button", onClick: () => accessToken && testDirectApiAccess(accessToken, fileId), disabled: !accessToken || !fileId, style: {
                            padding: "0.6rem 1.2rem",
                            background: "#fbbc05",
                            color: "black",
                            border: "none",
                            borderRadius: 4,
                        }, children: "3. Test Direct API Call" })] }), fileId && (_jsxs("div", { style: { marginBottom: "1rem", fontSize: "0.9rem" }, children: ["Fallback 1 helper:", " ", _jsx("a", { href: `https://docs.google.com/spreadsheets/d/${fileId}/edit`, target: "_blank", rel: "noreferrer", style: { color: "#1a73e8" }, children: "Open Sheet in Google First (adds to 'Shared with me')" })] })), _jsxs("div", { style: { fontWeight: "bold", marginBottom: "0.5rem" }, children: ["Status: ", status] }), _jsx("div", { style: {
                    background: "#1e1e1e",
                    color: "#d4d4d4",
                    padding: "1rem",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    minHeight: 180,
                    maxHeight: 350,
                    overflowY: "auto",
                }, children: logs.length === 0 ? (_jsx("div", { children: "Logs will appear here..." })) : (logs.map((log) => _jsx("div", { children: log.text }, log.id))) })] }));
}
//# sourceMappingURL=PickerSpike.js.map