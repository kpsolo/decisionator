import { publishTombstone } from "@decisionator/share-inpage";
import {
  Clock,
  ExternalLink,
  Radio,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { toast } from "../../components/ui/use-toast.js";
import { getStorageManager } from "../../storage/storage-manager.js";
import {
  type CachedLiveSessionRecord,
  deleteCachedLiveSession,
  listCachedLiveSessions,
} from "../../sync/db.js";
import { useLiveShare } from "./LiveShareContext.js";
import { RevokeSessionDialog } from "./RevokeSessionDialog.js";
import {
  hostCredentialsFor,
  isSessionRevoked,
  joinUrl,
  listHostedProjectKeys,
  loadNetworkConfig,
  markSessionRevoked,
  removeHostSessionIndex,
  rotateHostCredentials,
} from "./live-config.js";

interface HostedSessionView {
  projectKey: string;
  projectRef: { store: string; id: string };
  title: string;
  sessionId: string;
  link: string;
  createdAt: string;
  isLiveHere: boolean;
  connectedCount?: number;
  isRevoked: boolean;
}

export function SessionsDashboard() {
  const navigate = useNavigate();
  const live = useLiveShare();

  const [hosted, setHosted] = useState<HostedSessionView[]>([]);
  const [joined, setJoined] = useState<CachedLiveSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<HostedSessionView | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Load Hosted Sessions
      const keys = listHostedProjectKeys();
      const sm = getStorageManager();
      const hostedList: HostedSessionView[] = [];

      for (const pKey of keys) {
        const colon = pKey.indexOf(":");
        const storeId = colon >= 0 ? pKey.slice(0, colon) : pKey;
        const id = colon >= 0 ? pKey.slice(colon + 1) : "";
        const projectRef = { store: storeId, id };

        const creds = hostCredentialsFor(pKey);
        const isRevoked = isSessionRevoked(creds.sessionId);
        const link = joinUrl(creds);
        const isLiveHere = live.session?.key === pKey;
        const connectedCount = isLiveHere ? live.session?.state.guests.length : undefined;

        let title = `Project ${id.slice(0, 8)}`;
        try {
          const store = sm.resolveStore(projectRef);
          const snap = await store.openProject(projectRef);
          if (snap?.project.title) title = snap.project.title;
        } catch {
          // keep fallback title
        }

        hostedList.push({
          projectKey: pKey,
          projectRef,
          title,
          sessionId: creds.sessionId,
          link,
          createdAt: creds.createdAt ?? new Date().toISOString(),
          isLiveHere,
          connectedCount,
          isRevoked,
        });
      }
      setHosted(hostedList);

      // 2. Load Joined Sessions
      const cachedList = await listCachedLiveSessions();
      setJoined(cachedList);
    } catch (err) {
      toast({
        title: "Error loading sessions",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when live session changes
  useEffect(() => {
    void loadData();
  }, [live.session]);

  const handleDeleteJoined = async (sessionId: string, title: string) => {
    try {
      await deleteCachedLiveSession(sessionId);
      setJoined((prev) => prev.filter((j) => j.sessionId !== sessionId));
      toast({
        title: "Session removed",
        description: `Removed "${title}" from this device.`,
      });
    } catch (err) {
      toast({
        title: "Failed to remove session",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleRevokeConfirm = async (purgeRelays: boolean) => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    try {
      let relaysConfirmed = true;
      if (live.session?.key === target.projectKey) {
        await live.revoke("This session link has been revoked by the owner.", { purgeRelays });
      } else {
        // Not hosted here: still retract the relay snapshot, signed with the old host key.
        const credentials = hostCredentialsFor(target.projectKey);
        markSessionRevoked(credentials.sessionId, "Revoked from sessions dashboard");
        removeHostSessionIndex(credentials.sessionId);
        rotateHostCredentials(target.projectKey);
        const { relays } = loadNetworkConfig();
        if (purgeRelays && relays.length > 0) {
          relaysConfirmed = await publishTombstone({ credentials, relays });
        }
      }
      toast({
        title: "Session link revoked",
        description: relaysConfirmed
          ? `Revoked link for "${target.title}".`
          : `Revoked link for "${target.title}", but no relay confirmed the removal of its offline snapshot.`,
      });
      void loadData();
    } finally {
      setRevokeTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto py-2">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Sessions</h2>
          <p className="text-sm text-muted-foreground">
            Monitor and manage your shared collaborative decision sessions across devices.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadData()}
          disabled={loading}
          leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />}
        >
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="hosted" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="hosted" className="gap-2">
            <Radio className="h-4 w-4" />
            <span>Hosted Sessions ({hosted.length})</span>
          </TabsTrigger>
          <TabsTrigger value="joined" className="gap-2">
            <Users className="h-4 w-4" />
            <span>Joined Sessions ({joined.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* Hosted Sessions Tab */}
        <TabsContent value="hosted" className="space-y-4">
          {hosted.length === 0 ? (
            <Card>
              <CardHeader className="text-center py-10">
                <CardTitle className="text-base text-muted-foreground">
                  No hosted sessions yet
                </CardTitle>
                <CardDescription>
                  Start a live session from any project to invite guests and collaborate in real
                  time.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-3">
              {hosted.map((h) => (
                <Card key={h.projectKey} className="overflow-hidden">
                  <CardHeader className="py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold">{h.title}</CardTitle>
                          {h.isRevoked ? (
                            <Badge variant="destructive">Revoked</Badge>
                          ) : h.isLiveHere ? (
                            <Badge variant="success" className="gap-1.5">
                              <span className="inline-block h-2 w-2 rounded-full bg-success-foreground animate-pulse" />
                              Live in this tab ({h.connectedCount} connected)
                            </Badge>
                          ) : (
                            <Badge variant="outline">Idle</Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs">
                          Created {new Date(h.createdAt).toLocaleDateString()} • Session{" "}
                          {h.sessionId.slice(0, 8)}…
                        </CardDescription>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/p/${h.projectRef.store}/${h.projectRef.id}`)}
                          leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                        >
                          Open Project
                        </Button>

                        {!h.isRevoked && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setRevokeTarget(h)}
                            leftIcon={<ShieldAlert className="h-3.5 w-3.5" />}
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Joined Sessions Tab */}
        <TabsContent value="joined" className="space-y-4">
          {joined.length === 0 ? (
            <Card>
              <CardHeader className="text-center py-10">
                <CardTitle className="text-base text-muted-foreground">
                  No joined sessions on this device
                </CardTitle>
                <CardDescription>
                  Sessions you join via invite links are saved here for instant offline access.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-3">
              {joined.map((j) => (
                <Card key={j.sessionId} className="overflow-hidden">
                  <CardHeader className="py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold">
                            {j.projectTitle}
                          </CardTitle>
                          <Badge variant="secondary" className="text-xs">
                            Joined as {j.displayName || j.name}
                          </Badge>
                        </div>
                        <CardDescription className="flex items-center gap-2 text-xs">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Last synced {new Date(j.lastSyncedAt).toLocaleString()}</span>
                        </CardDescription>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const link = `/join/${j.sessionId}/${j.secret}${j.hostKey ? `/${j.hostKey}` : ""}`;
                            navigate(link);
                          }}
                          leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                        >
                          Reopen
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDeleteJoined(j.sessionId, j.projectTitle)}
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {revokeTarget && (
        <RevokeSessionDialog
          open={!!revokeTarget}
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          projectTitle={revokeTarget.title}
          onConfirm={handleRevokeConfirm}
        />
      )}
    </div>
  );
}
