import type React from "react";
import { useState } from "react";

export interface PasswordPromptProps {
  onUnlock: (password: string) => Promise<boolean>;
  error?: string;
}

export const PasswordPrompt: React.FC<PasswordPromptProps> = ({ onUnlock, error }) => {
  const [password, setPassword] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isLocked = lockedUntil !== null && Date.now() < lockedUntil;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked || !password) return;

    try {
      setLoading(true);
      setLocalError(null);
      const success = await onUnlock(password);
      if (!success) {
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        if (nextAttempts >= 5) {
          setLockedUntil(Date.now() + 30_000); // 30s lockout
          setLocalError("Too many incorrect attempts. Please wait 30 seconds before trying again.");
        } else {
          setLocalError(`Incorrect password. (${5 - nextAttempts} attempts remaining)`);
        }
      }
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="card"
      style={{ maxWidth: 440, margin: "40px auto", textAlign: "center", padding: 24 }}
    >
      <h3 style={{ marginBottom: 8 }}>Password-Protected Decision</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        This project is encrypted. Enter the project password to decrypt options and comments.
      </p>

      {(error || localError) && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(220, 38, 38, 0.1)",
            color: "var(--color-danger, #ef4444)",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {localError || error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="password"
          placeholder="Enter password..."
          value={password}
          disabled={isLocked || loading}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 14,
          }}
        />

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLocked || loading || !password}
        >
          {loading ? "Decrypting..." : isLocked ? "Locked (30s)" : "Unlock Project"}
        </button>
      </form>
    </div>
  );
};
