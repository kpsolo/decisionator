import type React from "react";
import { useState } from "react";

export interface PasswordSetupProps {
  onEnablePassword: (password: string) => Promise<void>;
  onCancel: () => void;
}

export const PasswordSetup: React.FC<PasswordSetupProps> = ({ onEnablePassword, onCancel }) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onEnablePassword(password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        maxWidth: 480,
        margin: "24px auto",
        padding: 24,
        background: "var(--card-bg, #18181b)",
      }}
    >
      <h3 style={{ marginBottom: 8 }}>Set Project Password</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        Add end-to-end client-side encryption (AES-256-GCM + PBKDF2) to protect this decision
        project.
      </p>

      {/* Warnings & Security disclosures (FR-017) */}
      <div
        style={{
          padding: "10px 14px",
          background: "rgba(234, 179, 8, 0.1)",
          border: "1px solid rgba(234, 179, 8, 0.3)",
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 12,
          color: "var(--color-warning, #eab308)",
          lineHeight: 1.5,
        }}
      >
        <strong>Important Security Notice:</strong>
        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
          <li>
            <strong>Lost passwords cannot be recovered.</strong> If you lose the password, your data
            is permanently unreadable.
          </li>
          <li>
            <strong>Metadata remains visible in Google Sheets:</strong> collaborator emails, option
            IDs, timestamps, and row counts remain readable in the Sheet grid. Option titles,
            descriptions, and comments are fully encrypted (<code>enc:v1:…</code>).
          </li>
          <li>The Google Sheet title will be renamed to "Deci project (protected)".</li>
        </ul>
      </div>

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

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label
            htmlFor="new-pwd-input"
            style={{ display: "block", fontSize: 12, marginBottom: 4, fontWeight: 500 }}
          >
            Password (at least 12 characters):
          </label>
          <input
            id="new-pwd-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="Enter passphrase (min 12 chars)..."
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
            }}
          />
        </div>

        <div>
          <label
            htmlFor="confirm-pwd-input"
            style={{ display: "block", fontSize: 12, marginBottom: 4, fontWeight: 500 }}
          >
            Confirm Password:
          </label>
          <input
            id="confirm-pwd-input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
            placeholder="Confirm passphrase..."
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn btn-outline"
            style={{ fontSize: 13 }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || password.length < 12 || password !== confirmPassword}
            className="btn btn-primary"
            style={{ fontSize: 13 }}
          >
            {loading ? "Encrypting Project..." : "Enable Password Protection"}
          </button>
        </div>
      </form>
    </div>
  );
};
