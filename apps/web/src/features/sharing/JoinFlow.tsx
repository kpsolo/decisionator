import { GoogleAuthService } from "@decisionator/store-google-sheets";
import { AlertCircle, CheckCircle, ExternalLink, KeyRound, LogIn } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
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
      } catch (_err) {
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
    <Card className="max-w-md mx-auto my-10 text-center">
      <CardHeader>
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" aria-hidden />
        </div>
        <CardTitle>Join Decision Project</CardTitle>
        <CardDescription>
          You were invited to view or contribute to this decision. Sign in with Google to confirm
          read or write access to this Sheet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentUserEmail && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="truncate mr-2">
              Signed in as: <strong className="text-foreground">{currentUserEmail}</strong>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSignIn(true)}
              className="h-7 px-2 text-xs"
            >
              Switch account
            </Button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-xs text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {needFallback && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-left text-xs space-y-2">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
              Access Confirmation Fallback (R21):
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Google Picker could not automatically add this public sheet. Click below to view it
              once in Google Sheets (which registers it in your Drive), then click Confirm.
            </p>
            <div className="flex gap-2 pt-1">
              <a
                href={`https://docs.google.com/spreadsheets/d/${fileId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                Open in Google Sheets
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              <Button
                type="button"
                size="sm"
                onClick={handleManualConfirm}
                leftIcon={<CheckCircle className="h-3.5 w-3.5" />}
              >
                Confirm Access
              </Button>
            </div>
          </div>
        )}

        {!currentUserEmail ? (
          <Button
            type="button"
            className="w-full"
            disabled={loading}
            isLoading={loading}
            onClick={() => handleSignIn(false)}
            leftIcon={<LogIn className="h-4 w-4" />}
          >
            {loading ? "Signing in..." : "Sign in with Google"}
          </Button>
        ) : (
          !needFallback && (
            <Button
              type="button"
              className="w-full"
              disabled={loading}
              isLoading={loading}
              onClick={() => openPickerForFile(currentUserEmail)}
            >
              {loading ? "Opening Picker..." : "Confirm Access in Google Picker"}
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
};
