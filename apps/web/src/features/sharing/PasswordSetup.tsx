import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";

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
    <Card className="mx-auto my-6 max-w-md">
      <CardHeader>
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span>Client-Side Encryption</span>
        </div>
        <CardTitle className="text-xl font-bold">Set Project Password</CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Add end-to-end client-side encryption (AES-256-GCM + PBKDF2) to protect this decision
          project.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {/* Warnings & Security disclosures (FR-017) */}
          <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-foreground">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
              <strong>Important Security Notice:</strong>
            </div>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>
                <strong>Lost passwords cannot be recovered.</strong> If you lose the password, your
                data is permanently unreadable.
              </li>
              <li>
                <strong>Metadata remains visible in Google Sheets:</strong> collaborator emails,
                option IDs, timestamps, and row counts remain readable in the Sheet grid. Option
                titles, descriptions, and comments are fully encrypted (<code>enc:v1:…</code>).
              </li>
              <li>The Google Sheet title will be renamed to "Deci project (protected)".</li>
            </ul>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive"
            >
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="new-pwd-input" className="text-xs font-semibold text-foreground">
                Password (at least 12 characters):
              </label>
              <Input
                id="new-pwd-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="Enter passphrase (min 12 chars)..."
                className="bg-background text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm-pwd-input" className="text-xs font-semibold text-foreground">
                Confirm Password:
              </label>
              <Input
                id="confirm-pwd-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                placeholder="Confirm passphrase..."
                className="bg-background text-sm"
              />
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={loading || password.length < 12 || password !== confirmPassword}
            isLoading={loading}
            leftIcon={<Lock className="h-3.5 w-3.5" aria-hidden />}
          >
            {loading ? "Encrypting Project..." : "Enable Password Protection"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default PasswordSetup;
