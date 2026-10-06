import React, { useState } from "react";
import { useStorage } from "../../storage/StorageContext.js";

export function StorageSettings() {
  const { storageManager, activeStoreId, setActiveStoreId } = useStorage();
  const [config, setConfig] = useState(() => storageManager.getConfig());
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [firebaseApiKey, setFirebaseApiKey] = useState(
    (config.configuredStores?.firestore?.apiKey as string) || ""
  );
  const [firebaseProjectId, setFirebaseProjectId] = useState(
    (config.configuredStores?.firestore?.projectId as string) || ""
  );
  const [firebaseAppId, setFirebaseAppId] = useState(
    (config.configuredStores?.firestore?.appId as string) || ""
  );

  const handleSelectActive = (storeId: string) => {
    setActiveStoreId(storeId);
    setSavedMessage(`Active storage switched to ${storeId.toUpperCase()}`);
    setTimeout(() => setSavedMessage(null), 3000);
  };

  const handleSaveFirebaseConfig = () => {
    const newConfig = {
      ...config,
      configuredStores: {
        ...config.configuredStores,
        firestore: {
          apiKey: firebaseApiKey,
          authDomain: `${firebaseProjectId}.firebaseapp.com`,
          projectId: firebaseProjectId,
          appId: firebaseAppId,
        },
      },
    };
    storageManager.saveConfig(newConfig);
    setConfig(newConfig);
    setSavedMessage("Firestore configuration saved successfully!");
    setTimeout(() => setSavedMessage(null), 3000);
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Storage & Persistence</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
        Choose where your decision projects are saved by default. When no remote storage is
        connected, Deci automatically saves directly to local files on your device.
      </p>

      {savedMessage && (
        <output
          style={{
            display: "block",
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(16, 185, 129, 0.15)",
            color: "#10b981",
            fontSize: 13,
          }}
        >
          ✓ {savedMessage}
        </output>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Local File Provider */}
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: `2px solid ${
              activeStoreId === "file" ? "var(--color-primary, #3b82f6)" : "var(--border)"
            }`,
            background: activeStoreId === "file" ? "rgba(59, 130, 246, 0.03)" : "var(--bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong>📁 Local File Storage</strong>
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
                OFFLINE-FIRST
              </span>
              {activeStoreId === "file" && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "#3b82f6",
                    fontWeight: 600,
                  }}
                >
                  ACTIVE
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              Zero-setup, private storage on your hard drive (.decisionator.json). No accounts or
              network required.
            </p>
          </div>
          {activeStoreId !== "file" && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => handleSelectActive("file")}
            >
              Set as Active
            </button>
          )}
        </div>

        {/* Google Sheets Provider */}
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: `2px solid ${
              activeStoreId === "google-sheets" ? "var(--color-primary, #3b82f6)" : "var(--border)"
            }`,
            background:
              activeStoreId === "google-sheets" ? "rgba(59, 130, 246, 0.03)" : "var(--bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong>📊 Google Sheets & Drive</strong>
              {activeStoreId === "google-sheets" && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "#3b82f6",
                    fontWeight: 600,
                  }}
                >
                  ACTIVE
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              Store projects in Google Sheets in your Drive with Drive link sharing and password
              protection.
            </p>
          </div>
          {activeStoreId !== "google-sheets" && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => handleSelectActive("google-sheets")}
            >
              Set as Active
            </button>
          )}
        </div>

        {/* Firestore Provider */}
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: `2px solid ${
              activeStoreId === "firestore" ? "var(--color-primary, #3b82f6)" : "var(--border)"
            }`,
            background: activeStoreId === "firestore" ? "rgba(59, 130, 246, 0.03)" : "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>🔥 Firebase Firestore</strong>
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(245, 158, 11, 0.15)",
                    color: "#f59e0b",
                    fontWeight: 600,
                  }}
                >
                  REAL-TIME SYNC
                </span>
                {activeStoreId === "firestore" && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(59, 130, 246, 0.15)",
                      color: "#3b82f6",
                      fontWeight: 600,
                    }}
                  >
                    ACTIVE
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                Real-time subsecond synchronization across collaborators via Firebase Firestore.
              </p>
            </div>
            {activeStoreId !== "firestore" && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => handleSelectActive("firestore")}
              >
                Set as Active
              </button>
            )}
          </div>

          {/* Firebase credentials configuration accordion/form */}
          <div
            style={{
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Firebase Configuration</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label htmlFor="fb-project-id" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Project ID
                </label>
                <input
                  id="fb-project-id"
                  type="text"
                  className="input"
                  placeholder="e.g. my-decisionator-app"
                  value={firebaseProjectId}
                  onChange={(e) => setFirebaseProjectId(e.target.value)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
              <div>
                <label htmlFor="fb-api-key" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  API Key
                </label>
                <input
                  id="fb-api-key"
                  type="password"
                  className="input"
                  placeholder="AIzaSy..."
                  value={firebaseApiKey}
                  onChange={(e) => setFirebaseApiKey(e.target.value)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="fb-app-id" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                App ID
              </label>
              <input
                id="fb-app-id"
                type="text"
                className="input"
                placeholder="1:123456789:web:abcdef"
                value={firebaseAppId}
                onChange={(e) => setFirebaseAppId(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12 }}
                onClick={handleSaveFirebaseConfig}
              >
                Save Firebase Credentials
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
