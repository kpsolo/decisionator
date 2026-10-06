import { Lock, Unlock } from "lucide-react";
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
    <Card className="mx-auto my-10 max-w-md text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-6 w-6" aria-hidden />
        </div>
        <CardTitle className="text-xl font-bold">Password-Protected Decision</CardTitle>
        <CardDescription className="mt-1 text-xs">
          This project is encrypted. Enter the project password to decrypt options and comments.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {(error || localError) && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive"
            >
              {localError || error}
            </div>
          )}

          <div className="space-y-1.5 text-left">
            <label htmlFor="unlock-password" className="text-xs font-semibold text-foreground">
              Project password
            </label>
            <Input
              id="unlock-password"
              type="password"
              placeholder="Enter password..."
              value={password}
              disabled={isLocked || loading}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background text-sm"
            />
          </div>
        </CardContent>

        <CardFooter className="flex justify-end border-t border-border pt-4">
          <Button
            type="submit"
            disabled={isLocked || loading || !password}
            isLoading={loading}
            leftIcon={
              isLocked ? (
                <Lock className="h-4 w-4" aria-hidden />
              ) : (
                <Unlock className="h-4 w-4" aria-hidden />
              )
            }
            className="w-full sm:w-auto"
          >
            {loading ? "Decrypting..." : isLocked ? "Locked (30s)" : "Unlock Project"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default PasswordPrompt;
