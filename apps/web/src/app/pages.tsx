import { runTally } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { ArrowLeft, BarChart3, Lock, Radio, Share2, Trophy, Vote } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { toast } from "../components/ui/use-toast.js";
import { CompareStrategiesDialog } from "../features/decide/CompareStrategiesDialog.js";
import { DecidedBy, DecisionMethodPicker } from "../features/decide/DecisionMethod.js";
import { StrategyChooser } from "../features/decide/StrategyChooser.js";
import {
  cannotRunReason,
  chosenStrategy,
  enabledStrategies,
} from "../features/decide/strategies.js";
import { LiveNetworkSettings } from "../features/live/LiveNetworkSettings.js";
import { projectKey, useLiveShare } from "../features/live/LiveShareContext.js";
import { OptionExtensionsProvider } from "../features/option-view/OptionExtensionsProvider.js";
import { getInstalledPlugins } from "../features/plugins/plugin-registry.js";
import { ProjectUnavailable } from "../features/project/ProjectUnavailable.js";
import { useProjectStore } from "../features/project/useProjectStore.js";
import { useRole } from "../features/project/useRole.js";
import { StorageSettings } from "../features/settings/StorageSettings.js";
import { PasswordSetup } from "../features/sharing/PasswordSetup.js";
import { ShareDialog } from "../features/sharing/ShareDialog.js";
import { RankBallot } from "../features/voting/RankBallot.js";
import { ResultsView } from "../features/voting/ResultsView.js";
import { VotingControls } from "../features/voting/VotingControls.js";

/** Shared page heading: title, subtitle and right-aligned actions that wrap on narrow screens. */
function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function PageLoading({ label }: { label: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

export function HomePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Welcome to Decisionator</CardTitle>
        <CardDescription>
          Collaborative Decision Engine for Teams. Pure client-side, encrypted, with deterministic
          strategies.
        </CardDescription>
        <div className="pt-3">
          <Button asChild>
            <Link to="/new">Create New Decision Project</Link>
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

export function NewProjectPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Create New Decision Project</CardTitle>
        <CardDescription>
          Paste ideas, select voting format, and choose your preferred backend.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function ProjectOverviewPage() {
  const { projectId: fileId, projectRef, store, baseUrl } = useProjectStore();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Project Overview</CardTitle>
        <CardDescription>
          Viewing project <code className="font-mono text-xs">{fileId}</code>
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-3">
          <Button asChild leftIcon={<Vote className="h-4 w-4" />}>
            <Link to={`${baseUrl}/vote`}>Vote</Link>
          </Button>
          <Button variant="outline" asChild leftIcon={<BarChart3 className="h-4 w-4" />}>
            <Link to={`${baseUrl}/stats`}>Stats</Link>
          </Button>
          <Button variant="outline" asChild leftIcon={<Trophy className="h-4 w-4" />}>
            <Link to={`${baseUrl}/results`}>Results</Link>
          </Button>
          <Button variant="outline" asChild leftIcon={<Share2 className="h-4 w-4" />}>
            <Link to={`${baseUrl}/share`}>Share</Link>
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

export function ProjectStatsPage() {
  const { projectId: fileId, projectRef, store, baseUrl } = useProjectStore();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Project Statistics</CardTitle>
        <CardDescription>
          Real-time metrics and grade distributions for{" "}
          <code className="font-mono text-xs">{fileId}</code>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function ProjectVotePage() {
  const { projectId: fileId, projectRef, store, baseUrl } = useProjectStore();
  const [snapshot, setSnapshot] = React.useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [currentUser, setCurrentUser] = React.useState("");

  React.useEffect(() => {
    if (!fileId) return;
    async function load() {
      try {
        setLoading(true);
        const identity = await store.signIn({ interactive: false });
        setCurrentUser(identity.participantId);
        const snap = await store.openProject(projectRef);
        setSnapshot(snap);
      } catch (err: unknown) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fileId, store, projectRef]);

  if (loadError) {
    return <ProjectUnavailable reason="not_found" details={loadError} />;
  }
  if (!fileId || loading || !snapshot) {
    return <PageLoading label="Loading voting..." />;
  }

  // useRole is a pure function (no React hooks), so calling it after the early return is safe.
  const roleCaps = useRole(snapshot.role);
  const currentRound = snapshot.project.voting?.round ?? 1;
  const topN = snapshot.project.voting?.topN ?? 3;
  const isOwner = snapshot.role === "owner";

  const myBallot = snapshot.rankings.find(
    (r) => r.by === currentUser && (r.round ?? 1) === currentRound
  );

  const handleSubmitBallot = async (ranking: string[]) => {
    await store.append(projectRef, [{ kind: "ranking", ranking, round: currentRound }]);
    const updated = await store.openProject(projectRef);
    setSnapshot(updated);
  };

  const handleUpdateVoting = async (voting: NonNullable<ProjectSnapshot["project"]["voting"]>) => {
    await store.updateMeta(projectRef, { voting });
    const updated = await store.openProject(projectRef);
    setSnapshot(updated);
  };

  const handleSaveStrategy = async (strategy: {
    id: string;
    version: string;
    settings: Record<string, unknown>;
  }) => {
    await store.updateMeta(projectRef, { strategy });
    setSnapshot(await store.openProject(projectRef));
  };

  const handleCloseAndTally = async () => {
    // The project's chosen method decides (FR-036); never fall back silently.
    const chosen = chosenStrategy(snapshot, enabledStrategies(getInstalledPlugins()));
    const reason = cannotRunReason(snapshot, chosen);
    if (reason || !chosen.descriptor) {
      toast({
        title: "Voting stays open",
        description: reason ?? undefined,
        variant: "destructive",
      });
      return;
    }
    const outcome = await runTally({
      snapshot,
      strategy: chosen.descriptor.strategy,
      strategyId: chosen.id,
      strategyVersion: chosen.version,
      triggeredBy: currentUser,
      settings: chosen.settings,
      runInput: typeof chosen.settings.pick === "string" ? chosen.settings.pick : undefined,
      usesRandomness: chosen.descriptor.usesRandomness,
    });

    // Close voting state
    const nextVoting = {
      ...(snapshot.project.voting ?? {
        state: "open" as const,
        round: 1,
        topN: 3,
        liveResults: true,
      }),
      state: "closed" as const,
    };

    await store.updateMeta(projectRef, { voting: nextVoting });
    await store.append(projectRef, [{ kind: "outcome", outcome }]);

    const updated = await store.openProject(projectRef);
    setSnapshot(updated);
  };

  return (
    <OptionExtensionsProvider
      viewerId={currentUser || null}
      isOwner={isOwner}
      options={snapshot.options}
      properties={snapshot.properties}
      appendProperties={async (entries) => {
        await store.append(projectRef, entries);
      }}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader
          title="Ballot / Voting"
          description={`${snapshot.project.title} — Round ${currentRound}`}
          actions={
            <>
              <Button variant="outline" size="sm" asChild leftIcon={<Trophy className="h-4 w-4" />}>
                <Link to={`${baseUrl}/results`}>Results</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                <Link to={baseUrl}>Project</Link>
              </Button>
            </>
          }
        />

        <DecidedBy snapshot={snapshot} />

        {isOwner && (
          <VotingControls
            voting={snapshot.project.voting}
            onUpdateVoting={handleUpdateVoting}
            onCloseAndTally={handleCloseAndTally}
          />
        )}
        {isOwner && <DecisionMethodPicker snapshot={snapshot} onSave={handleSaveStrategy} />}

        <RankBallot
          options={snapshot.options}
          topN={topN}
          initialRanking={myBallot?.ranking}
          disabled={!roleCaps.canVote || snapshot.project.voting?.state === "closed"}
          disabledReason={
            snapshot.project.voting?.state === "closed"
              ? "Voting is currently closed for this round."
              : roleCaps.disabledReason
          }
          onSubmitBallot={handleSubmitBallot}
        />
      </div>
    </OptionExtensionsProvider>
  );
}

export function ProjectResultsPage() {
  const { projectId: fileId, projectRef, store, baseUrl } = useProjectStore();
  const [snapshot, setSnapshot] = React.useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [currentUser, setCurrentUser] = React.useState("");

  React.useEffect(() => {
    if (!fileId) return;
    async function load() {
      try {
        setLoading(true);
        const identity = await store.signIn({ interactive: false });
        setCurrentUser(identity.participantId);
        const snap = await store.openProject(projectRef);
        setSnapshot(snap);
      } catch (err: unknown) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fileId, store, projectRef]);

  if (loadError) {
    return <ProjectUnavailable reason="not_found" details={loadError} />;
  }
  if (!fileId || loading || !snapshot) {
    return <PageLoading label="Loading results..." />;
  }

  const currentRound = snapshot.project.voting?.round ?? 1;
  const liveResults = snapshot.project.voting?.liveResults ?? true;
  const isOpen = snapshot.project.voting?.state === "open";
  const isOwner = snapshot.role === "owner";
  // Others may compare once results are visible to them (FR-040).
  const canCompare = isOwner || liveResults || !isOpen;

  return (
    <OptionExtensionsProvider
      viewerId={currentUser || null}
      isOwner={isOwner}
      options={snapshot.options}
      properties={snapshot.properties}
      appendProperties={async (entries) => {
        await store.append(projectRef, entries);
      }}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader
          title="Decision Outcome & Results"
          description={snapshot.project.title}
          actions={
            <>
              <Button variant="outline" size="sm" asChild leftIcon={<Vote className="h-4 w-4" />}>
                <Link to={`${baseUrl}/vote`}>Ballot</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                <Link to={baseUrl}>Project</Link>
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <DecidedBy snapshot={snapshot} />
          {canCompare && (
            <CompareStrategiesDialog
              snapshot={snapshot}
              canAdopt={isOwner}
              triggeredBy={currentUser}
              onAdopt={async (outcome) => {
                await store.append(projectRef, [{ kind: "outcome", outcome }]);
                setSnapshot(await store.openProject(projectRef));
              }}
            />
          )}
        </div>

        <ResultsView
          outcomes={snapshot.outcomes}
          options={snapshot.options}
          rankings={snapshot.rankings}
          currentRound={currentRound}
          liveResults={liveResults}
          isOpen={isOpen}
        />

        {snapshot.role === "owner" && (
          <StrategyChooser
            snapshot={snapshot}
            store={store}
            projectRef={projectRef}
            currentUser={currentUser}
            isOwner={true}
            onOutcomeCreated={(newOutcome) => {
              setSnapshot({
                ...snapshot,
                outcomes: [...snapshot.outcomes, newOutcome],
              });
            }}
          />
        )}
      </div>
    </OptionExtensionsProvider>
  );
}

export function ProjectSharePage() {
  const { projectId: fileId, storeId, projectRef, store, baseUrl } = useProjectStore();
  const [showPasswordSetup, setShowPasswordSetup] = React.useState(false);
  // Projects stored on this device have no link to hand out; they're shared as a live session.
  const isLocal = storeId === "file";
  // ShareDialog is modal; open it on arrival and let closing it reveal the rest of the page.
  const [shareOpen, setShareOpen] = React.useState(!isLocal);
  const [projectTitle, setProjectTitle] = React.useState("");
  const live = useLiveShare();
  const isLiveHere = live.session?.key === projectKey(projectRef);

  React.useEffect(() => {
    if (!isLocal || !fileId) return;
    store
      .openProject(projectRef)
      .then((snap) => setProjectTitle(snap.project.title))
      .catch(() => setProjectTitle(""));
  }, [isLocal, fileId, store, projectRef]);

  if (!fileId) return <div>Project ID missing</div>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Share Decision Project"
        description={
          <>
            {isLocal
              ? "Invite people to grade and vote on "
              : "Manage link access, invite collaborators, and configure encryption for "}
            <code className="font-mono text-xs">{projectTitle || fileId}</code>.
          </>
        }
        actions={
          <>
            {!isLocal && (
              <Button
                size="sm"
                onClick={() => setShareOpen(true)}
                leftIcon={<Share2 className="h-4 w-4" />}
              >
                Sharing settings
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild leftIcon={<ArrowLeft className="h-4 w-4" />}>
              <Link to={baseUrl}>Back to Project</Link>
            </Button>
          </>
        }
      />

      {isLocal ? (
        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-base">This project is stored on this device</CardTitle>
            <CardDescription className="leading-relaxed">
              There is no shareable link for a local project. Start a live session to let others
              join from their browsers or phones while this tab stays open, or move the project to
              Google Sheets or Firestore in Settings to share it by link.
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                onClick={() =>
                  live.openFor({ store, projectRef, projectTitle: projectTitle || fileId })
                }
                leftIcon={<Radio className="h-4 w-4" />}
              >
                {isLiveHere ? "Show live session" : "Start live session"}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/settings">Storage settings</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : (
        shareOpen && (
          <ShareDialog store={store} projectRef={projectRef} onClose={() => setShareOpen(false)} />
        )
      )}

      {!isLocal &&
        (!showPasswordSetup ? (
          <Card>
            <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base">Client-Side Encryption</CardTitle>
                <CardDescription>
                  Protect options and discussions with AES-256-GCM encryption before sending to
                  Google Sheets.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPasswordSetup(true)}
                leftIcon={<Lock className="h-4 w-4" />}
                className="shrink-0"
              >
                Enable Password Protection
              </Button>
            </CardHeader>
          </Card>
        ) : (
          <PasswordSetup
            onEnablePassword={async (_password) => {
              setShowPasswordSetup(false);
            }}
            onCancel={() => setShowPasswordSetup(false)}
          />
        ))}
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Application Settings"
        description="Storage provider settings, active persistence target, and credentials management."
      />
      <StorageSettings />
      <LiveNetworkSettings />
    </div>
  );
}
