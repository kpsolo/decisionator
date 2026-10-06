import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { type PluginManifest, validateManifest } from "../../host/module-host.js";
import { PluginSettings } from "./PluginSettings.js";
import {
  type InstalledPlugin,
  getInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
} from "./plugin-registry.js";

export function PluginsPage() {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(() => getInstalledPlugins());
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [installMode, setInstallMode] = useState<"file" | "url">("file");
  const [installUrl, setInstallUrl] = useState("");
  const [_manifestText, setManifestText] = useState("");
  const [pendingManifest, setPendingManifest] = useState<PluginManifest | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [editingSettingsPlugin, setEditingSettingsPlugin] = useState<InstalledPlugin | null>(null);
  const [reviewingPermsPlugin, setReviewingPermsPlugin] = useState<InstalledPlugin | null>(null);

  const refreshPlugins = () => {
    setPlugins(getInstalledPlugins());
  };

  const handleToggleEnable = (plugin: InstalledPlugin) => {
    updatePlugin(plugin.id, { enabled: !plugin.enabled });
    refreshPlugins();
  };

  const handleUninstall = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to uninstall plugin "${name}"?`)) {
      uninstallPlugin(id);
      refreshPlugins();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInstallError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        setManifestText(text);
        const parsed = JSON.parse(text);
        validateManifest(parsed);
        setPendingManifest(parsed);
        setSelectedPermissions(parsed.permissions ? [...parsed.permissions] : []);
      } catch (err) {
        setPendingManifest(null);
        setInstallError(err instanceof Error ? err.message : "Invalid plugin manifest JSON");
      }
    };
    reader.readAsText(file);
  };

  const handleFetchUrl = async () => {
    setInstallError(null);
    if (!installUrl.trim()) return;

    try {
      const res = await fetch(installUrl.trim());
      if (!res.ok) {
        throw new Error(`Failed to fetch from URL: HTTP ${res.status}`);
      }
      const parsed = await res.json();
      validateManifest(parsed);
      setPendingManifest(parsed);
      setSelectedPermissions(parsed.permissions ? [...parsed.permissions] : []);
    } catch (err) {
      setPendingManifest(null);
      setInstallError(err instanceof Error ? err.message : "Failed to load manifest from URL");
    }
  };

  const handleConfirmInstall = () => {
    if (!pendingManifest) return;

    try {
      installPlugin(
        pendingManifest,
        installMode === "file"
          ? { type: "file", filename: pendingManifest.name || "plugin.json" }
          : { type: "url", url: installUrl },
        selectedPermissions
      );

      refreshPlugins();
      setIsInstallOpen(false);
      setPendingManifest(null);
      setInstallUrl("");
      setManifestText("");
      setSelectedPermissions([]);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    }
  };

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Plugins & Extensions</h2>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-muted, #64748b)" }}>
            Manage decision strategies, idea sources, and sandboxed extensions (FR-050).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setIsInstallOpen(true);
            setInstallError(null);
            setPendingManifest(null);
          }}
        >
          + Install Plugin
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="card"
            style={{
              padding: 20,
              borderLeft: plugin.enabled
                ? "4px solid #10b981"
                : "4px solid var(--border-color, #cbd5e1)",
              opacity: plugin.enabled ? 1 : 0.75,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h3 style={{ margin: 0 }}>{plugin.name}</h3>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 12,
                      backgroundColor: "var(--bg-muted, #f1f5f9)",
                      color: "var(--text-muted, #64748b)",
                      fontFamily: "monospace",
                    }}
                  >
                    v{plugin.version}
                  </span>
                  {plugin.source.type === "builtin" && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        backgroundColor: "#e0f2fe",
                        color: "#0369a1",
                        fontWeight: 600,
                      }}
                    >
                      Built-in
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 12,
                      backgroundColor: plugin.enabled ? "#dcfce7" : "#fee2e2",
                      color: plugin.enabled ? "#166534" : "#991b1b",
                      fontWeight: 500,
                    }}
                  >
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted, #64748b)",
                    margin: "4px 0",
                    fontFamily: "monospace",
                  }}
                >
                  {plugin.id}
                </div>

                {plugin.description && (
                  <p style={{ margin: "8px 0 12px 0", fontSize: 14 }}>{plugin.description}</p>
                )}

                {/* Last Error if any */}
                {plugin.lastError && (
                  <div
                    style={{
                      backgroundColor: "#fef2f2",
                      border: "1px solid #fecaca",
                      color: "#b91c1c",
                      padding: "8px 12px",
                      borderRadius: 6,
                      fontSize: 13,
                      marginBottom: 12,
                    }}
                  >
                    ⚠️ <strong>Error:</strong> {plugin.lastError}
                  </div>
                )}

                {/* Granted permissions */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
                    Permissions:
                  </span>
                  {plugin.grantedPermissions.length > 0 ? (
                    plugin.grantedPermissions.map((perm) => (
                      <span
                        key={perm}
                        style={{
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 4,
                          backgroundColor: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          fontFamily: "monospace",
                        }}
                      >
                        {perm}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
                      None requested
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className={plugin.enabled ? "btn btn-outline" : "btn btn-primary"}
                  onClick={() => handleToggleEnable(plugin)}
                >
                  {plugin.enabled ? "Disable" : "Enable"}
                </button>

                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setReviewingPermsPlugin(plugin)}
                >
                  Permissions
                </button>

                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingSettingsPlugin(plugin)}
                >
                  Settings
                </button>

                {plugin.source.type !== "builtin" && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ color: "#ef4444" }}
                    onClick={() => handleUninstall(plugin.id, plugin.name)}
                    aria-label={`Uninstall ${plugin.name}`}
                  >
                    Uninstall
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Settings Modal */}
      {editingSettingsPlugin && (
        <PluginSettings
          plugin={editingSettingsPlugin}
          onSave={(newSettings) => {
            updatePlugin(editingSettingsPlugin.id, { settings: newSettings });
            refreshPlugins();
          }}
          onClose={() => setEditingSettingsPlugin(null)}
        />
      )}

      {/* Permissions Review Modal */}
      {reviewingPermsPlugin && (
        <dialog
          open
          aria-labelledby="perms-review-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
            border: "none",
            width: "100%",
            height: "100%",
            maxWidth: "none",
            maxHeight: "none",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 500,
              width: "100%",
              backgroundColor: "var(--bg-card, #ffffff)",
              borderRadius: 8,
              padding: 24,
            }}
          >
            <h3 id="perms-review-title" style={{ marginTop: 0 }}>
              Permissions: {reviewingPermsPlugin.name}
            </h3>
            <p style={{ fontSize: 14, color: "var(--text-muted, #64748b)" }}>
              Review or revoke capabilities granted to this plugin.
            </p>

            <div style={{ margin: "16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
              {reviewingPermsPlugin.manifest.permissions &&
              reviewingPermsPlugin.manifest.permissions.length > 0 ? (
                reviewingPermsPlugin.manifest.permissions.map((perm) => {
                  const isChecked = reviewingPermsPlugin.grantedPermissions.includes(perm);
                  return (
                    <label
                      key={perm}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const updated = isChecked
                            ? reviewingPermsPlugin.grantedPermissions.filter((p) => p !== perm)
                            : [...reviewingPermsPlugin.grantedPermissions, perm];
                          const updatedRecord = updatePlugin(reviewingPermsPlugin.id, {
                            grantedPermissions: updated,
                          });
                          if (updatedRecord) setReviewingPermsPlugin({ ...updatedRecord });
                          refreshPlugins();
                        }}
                      />
                      <span style={{ fontFamily: "monospace" }}>{perm}</span>
                    </label>
                  );
                })
              ) : (
                <div style={{ fontSize: 14, color: "var(--text-muted, #64748b)" }}>
                  No optional permissions declared by this plugin.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setReviewingPermsPlugin(null)}
              >
                Done
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Install Plugin Modal */}
      {isInstallOpen && (
        <dialog
          open
          aria-labelledby="install-plugin-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
            border: "none",
            width: "100%",
            height: "100%",
            maxWidth: "none",
            maxHeight: "none",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 600,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              backgroundColor: "var(--bg-card, #ffffff)",
              borderRadius: 8,
              padding: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h3 id="install-plugin-title" style={{ margin: 0 }}>
                Install Plugin
              </h3>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setIsInstallOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Unreviewed Source Warning (FR-061) */}
            <div
              style={{
                backgroundColor: "#fffbeb",
                border: "1px solid #fef3c7",
                color: "#92400e",
                padding: "12px 16px",
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 20,
              }}
            >
              <strong>⚠️ Unreviewed Source Warning:</strong>
              <p style={{ margin: "4px 0 0 0" }}>
                Third-party plugins execute in an isolated sandbox. Only install plugins from
                creators you trust. Review all requested permissions carefully before installing
                (FR-061).
              </p>
            </div>

            {/* Mode selection */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <button
                type="button"
                className={installMode === "file" ? "btn btn-primary" : "btn btn-outline"}
                onClick={() => {
                  setInstallMode("file");
                  setPendingManifest(null);
                  setInstallError(null);
                }}
              >
                Install from File
              </button>
              <button
                type="button"
                className={installMode === "url" ? "btn btn-primary" : "btn btn-outline"}
                onClick={() => {
                  setInstallMode("url");
                  setPendingManifest(null);
                  setInstallError(null);
                }}
              >
                Install from URL
              </button>
            </div>

            {installMode === "file" ? (
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="plugin-file-input"
                  style={{ display: "block", fontSize: 14, marginBottom: 6 }}
                >
                  Select plugin manifest file (<code>decisionator-plugin.json</code>):
                </label>
                <input
                  id="plugin-file-input"
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
                  style={{ width: "100%", padding: 8 }}
                />
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="plugin-url-input"
                  style={{ display: "block", fontSize: 14, marginBottom: 6 }}
                >
                  Enter manifest HTTPS URL:
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="plugin-url-input"
                    type="url"
                    placeholder="https://example.com/decisionator-plugin.json"
                    value={installUrl}
                    onChange={(e) => setInstallUrl(e.target.value)}
                    style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #cbd5e1" }}
                  />
                  <button type="button" className="btn btn-outline" onClick={handleFetchUrl}>
                    Load
                  </button>
                </div>
              </div>
            )}

            {installError && (
              <div
                style={{
                  backgroundColor: "#fef2f2",
                  color: "#b91c1c",
                  padding: "10px 14px",
                  borderRadius: 6,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                ✕ {installError}
              </div>
            )}

            {/* Manifest Preview & Permission Review */}
            {pendingManifest && (
              <div
                style={{
                  backgroundColor: "var(--bg-muted, #f8fafc)",
                  padding: 16,
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                <h4 style={{ margin: "0 0 8px 0" }}>
                  {pendingManifest.name}{" "}
                  <span style={{ fontSize: 12 }}>v{pendingManifest.version}</span>
                </h4>
                <div
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    fontFamily: "monospace",
                    marginBottom: 8,
                  }}
                >
                  {pendingManifest.id}
                </div>
                {(pendingManifest as { description?: string }).description && (
                  <p style={{ fontSize: 14, margin: "0 0 12px 0" }}>
                    {(pendingManifest as { description?: string }).description}
                  </p>
                )}

                <h5 style={{ margin: "12px 0 6px 0" }}>Permission Review:</h5>
                <p
                  style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: "0 0 8px 0" }}
                >
                  Select which capabilities to grant this plugin:
                </p>

                {pendingManifest.permissions && pendingManifest.permissions.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {pendingManifest.permissions.map((perm: string) => (
                      <label
                        key={perm}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(perm)}
                          onChange={() => togglePermission(perm)}
                        />
                        <span style={{ fontFamily: "monospace" }}>{perm}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>
                    This plugin requests no sensitive permissions.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setIsInstallOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pendingManifest}
                onClick={handleConfirmInstall}
              >
                Confirm & Install
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
