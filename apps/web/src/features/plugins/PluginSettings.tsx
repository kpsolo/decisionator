import Form from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import React, { useState } from "react";
import type { InstalledPlugin } from "./plugin-registry.js";

export interface PluginSettingsProps {
  plugin: InstalledPlugin;
  onSave: (settings: Record<string, unknown>) => void;
  onClose: () => void;
}

export function PluginSettings({ plugin, onSave, onClose }: PluginSettingsProps) {
  const settingsSchema = (plugin.manifest as { settingsSchema?: RJSFSchema }).settingsSchema;
  const settingsUiSchema = (plugin.manifest as { settingsUiSchema?: UiSchema }).settingsUiSchema;

  const [formData, setFormData] = useState<Record<string, unknown>>(() => ({
    ...plugin.settings,
  }));
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSubmit = (data: { formData?: Record<string, unknown> }) => {
    const updated = data.formData ?? {};
    setFormData(updated);
    onSave(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <dialog
      open
      aria-labelledby="plugin-settings-title"
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
          maxHeight: "85vh",
          overflowY: "auto",
          backgroundColor: "var(--bg-card, #ffffff)",
          borderRadius: 8,
          boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border-color, #e2e8f0)",
            paddingBottom: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h3 id="plugin-settings-title" style={{ margin: 0 }}>
              Settings: {plugin.name}
            </h3>
            <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
              v{plugin.version} ({plugin.id})
            </span>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {saveSuccess && (
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: "#dcfce7",
              color: "#166534",
              borderRadius: 6,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            ✓ Settings saved successfully.
          </div>
        )}

        {settingsSchema ? (
          <div>
            <p style={{ fontSize: 14, color: "var(--text-muted, #64748b)", marginBottom: 16 }}>
              Configure preferences generated dynamically from the plugin schema (FR-053).
            </p>
            <Form
              schema={settingsSchema}
              uiSchema={settingsUiSchema}
              validator={validator}
              formData={formData}
              onSubmit={handleSubmit}
            >
              <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Settings
                </button>
              </div>
            </Form>
          </div>
        ) : (
          <div>
            <p style={{ color: "var(--text-muted, #64748b)" }}>
              This plugin does not declare any configurable settings.
            </p>
            <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
