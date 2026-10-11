import { type Comment, computeOptionStats } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import {
  type GuestEntry,
  type LiveGuestState,
  type LiveShareGuest,
  joinSession,
} from "@decisionator/share-inpage";
import {
  Copy,
  Download,
  Eye,
  Link2Off,
  Loader2,
  Radio,
  RefreshCw,
  ShieldAlert,
  Unplug,
  Users,
  WifiOff,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { toast } from "../../components/ui/use-toast.js";
import { getStorageManager } from "../../storage/storage-manager.js";
import {
  type CachedLiveSessionRecord,
  cacheLiveSession,
  deleteCachedLiveSession,
  getCachedLiveSession,
} from "../../sync/db.js";
import { CommentThread } from "../comments/CommentThread.js";
import { CompareStrategiesDialog } from "../decide/CompareStrategiesDialog.js";
import { DecidedBy } from "../decide/DecisionMethod.js";
import { OptionRow } from "../grading/OptionRow.js";
import { averageText, ballotText, ownGradeText } from "../history/time-texts.js";
import { FilterableOptionList } from "../option-view/FilterableOptionList.js";
import { OptionExtensionsProvider } from "../option-view/OptionExtensionsProvider.js";
import { createBatcher } from "../option-view/batcher.js";
import { downloadProjectExport } from "../project/project-file.js";
import { RankBallot } from "../voting/RankBallot.js";
import { ResultsView } from "../voting/ResultsView.js";
import { ForkSessionDialog } from "./ForkSessionDialog.js";
import { useLiveShare } from "./LiveShareContext.js";
import {
  getSessionRevocation,
  guestDeviceSecret,
  isSessionRevoked,
  loadNetworkConfig,
  resolveHostProject,
  saveGuestName,
  savedGuestName,
} from "./live-config.js";

/** `/join/:sessionId/:secret[/:hostKey]` — a guest joining a live session hosted in someone's tab. */
export function JoinLivePage() {
  const { sessionId, secret, hostKey } = useParams();
  const navigate = useNavigate();
  const liveShare = useLiveShare();
  const [cachedSession, setCachedSession] = useState<CachedLiveSessionRecord | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);
  const [name, setName] = useState(savedGuestName);
  const [joinedAs, setJoinedAs] = useState<string | null>(null);
  const nameId = useId();

  // Read local offline cache on mount (SC-001, FR-003)
  useEffect(() => {
    let active = true;
    if (sessionId) {
      void getCachedLiveSession(sessionId).then((rec) => {
        if (!active) return;
        if (rec) {
          setCachedSession(rec);
          void cacheLiveSession({ ...rec, lastOpenedAt: new Date().toISOString() });
        }
        setCacheChecked(true);
      });
    } else {
      setCacheChecked(true);
    }
    return () => {
      active = false;
    };
  }, [sessionId]);

  // 1. Check if session has been revoked on this device (FR-011, US5)
  if (sessionId && isSessionRevoked(sessionId)) {
    const rev = getSessionRevocation(sessionId);
    return (
      <Card className="mx-auto mt-6 max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <Link2Off className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle>This session link has been revoked by the owner.</CardTitle>
          <CardDescription>
            {rev?.reason ||
              "This link is no longer valid. The owner may have ended or revoked the session."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // 2. Check if current browser is the host of this session (FR-001, US1)
  const hostProject = sessionId ? resolveHostProject(sessionId) : null;
  if (hostProject) {
    const colon = hostProject.indexOf(":");
    const storeId = colon >= 0 ? hostProject.slice(0, colon) : hostProject;
    const id = colon >= 0 ? hostProject.slice(colon + 1) : "";
    const projectPath = `/p/${storeId}/${id}`;

    return (
      <Card className="mx-auto mt-6 max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Radio className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle>You are the host of this session</CardTitle>
          <CardDescription>
            This live deliberation was created in this browser. You can resume live hosting for
            returning collaborators or open the project directly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            onClick={() => {
              const sm = getStorageManager();
              const projectRef = { store: storeId, id };
              const store = sm.resolveStore(projectRef);
              void liveShare.openFor({
                store,
                projectRef,
                projectTitle: "Live Session",
              });
              navigate(projectPath);
            }}
          >
            Resume Live Session
          </Button>
          <Button variant="outline" onClick={() => navigate(projectPath)}>
            Open Project
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isMalformed = !sessionId || !secret || sessionId.length < 6 || secret.length < 10;
  if (isMalformed) {
    return (
      <Card className="mx-auto mt-6 max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Link2Off className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle>This link is incomplete or damaged.</CardTitle>
          <CardDescription>
            The link is missing required security keys or has been corrupted. Ask the host to copy
            the link again or to show you the QR code.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (cachedSession) {
    return (
      <GuestSession
        sessionId={sessionId}
        secret={secret}
        hostKey={hostKey}
        displayName={cachedSession.displayName || cachedSession.name}
        initialCached={cachedSession}
      />
    );
  }

  if (!joinedAs) {
    return (
      <Card className="mx-auto mt-6 max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle>Join a live decision</CardTitle>
          <CardDescription>
            You connect straight to the host's browser. Your name is shown next to your comments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              saveGuestName(trimmed);
              setJoinedAs(trimmed);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-sm font-medium">
                Your name
              </label>
              <Input
                id={nameId}
                value={name}
                maxLength={80}
                required
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={!name.trim()}>
              Join
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <GuestSession
      sessionId={sessionId}
      secret={secret}
      hostKey={hostKey}
      displayName={joinedAs}
      initialCached={null}
    />
  );
}

function GuestSession({
  sessionId,
  secret,
  hostKey,
  displayName,
  initialCached,
}: {
  sessionId: string;
  secret: string;
  hostKey?: string;
  displayName: string;
  initialCached?: CachedLiveSessionRecord | null;
}) {
  const [guest, setGuest] = useState<LiveShareGuest | null>(null);
  const [state, setState] = useState<LiveGuestState | null>(null);
  const [cached, setCached] = useState<CachedLiveSessionRecord | null>(initialCached ?? null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connection lifecycle is keyed by credentials and displayName
  useEffect(() => {
    let joined: ReturnType<typeof joinSession>;
    try {
      joined = joinSession({
        credentials: { sessionId, secret, hostKey },
        deviceSecret: guestDeviceSecret(),
        displayName,
        config: loadNetworkConfig(),
        onNotice: (msg) => {
          toast({ title: msg });
        },
      });
    } catch (err) {
      setUnsupported(err instanceof Error ? err.message : String(err));
      return;
    }
    const off = joined.guest.subscribe((s) => {
      setState(s);
      if (s.status === "revoked") {
        void deleteCachedLiveSession(sessionId);
        setCached(null);
        return;
      }
      if (s.notice) {
        toast({ title: s.notice });
      }
      if (s.snapshot) {
        const now = new Date().toISOString();
        const record: CachedLiveSessionRecord = {
          sessionId,
          secret,
          hostKey: hostKey ?? cached?.hostKey ?? null,
          participantId: s.participantId ?? cached?.participantId ?? "",
          displayName,
          name: s.name ?? cached?.name ?? displayName,
          role: s.role ?? cached?.role ?? "contribute",
          projectTitle: s.snapshot.project.title,
          rev: s.rev ?? 1,
          snapshot: s.snapshot,
          cachedAt: cached?.cachedAt ?? now,
          lastSyncedAt: s.status === "live" ? now : (cached?.lastSyncedAt ?? now),
          lastOpenedAt: now,
        };
        setCached(record);
        void cacheLiveSession(record);
      }
    });
    joined.guest.start();
    setGuest(joined.guest);
    // Say goodbye when the tab goes, so the host's list of connected people drops us at once.
    const onPageHide = () => joined.dispose();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      off();
      joined.dispose();
    };
  }, [sessionId, secret, hostKey, displayName]);

  if (state?.status === "revoked") {
    return (
      <Card className="mx-auto mt-6 max-w-md border-destructive/40">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle>This session link has been revoked by the owner.</CardTitle>
          <CardDescription>
            {state.message ||
              "This link is no longer valid. The owner may have ended or revoked the session."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (unsupported) {
    return (
      <StatusCard icon={<Unplug className="h-5 w-5" />} title="Can't join" body={unsupported} />
    );
  }

  const activeSnapshot = state?.snapshot ?? cached?.snapshot;

  if (!activeSnapshot) {
    if (state?.status === "failed") {
      return (
        <StatusCard
          icon={<WifiOff className="h-5 w-5" />}
          title="This session can't be reached right now."
          body={state.message || "The host may be offline, or the link may be wrong or revoked."}
          action={
            guest ? (
              <Button onClick={() => guest.retry()} leftIcon={<RefreshCw className="h-4 w-4" />}>
                Retry
              </Button>
            ) : undefined
          }
        />
      );
    }
    return (
      <Card className="mx-auto mt-6 max-w-md" aria-busy="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-primary motion-safe:animate-spin" aria-hidden />
            Connecting to the host…
          </CardTitle>
          <CardDescription>
            The host's tab needs to be open with the live session running. This can take a few
            seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <GuestWorkspace
      guest={guest}
      state={state}
      snapshot={activeSnapshot}
      displayName={displayName}
      cachedSession={cached}
    />
  );
}

function GuestWorkspace({
  guest,
  state,
  snapshot,
  displayName,
  cachedSession,
}: {
  guest: LiveShareGuest | null;
  state: LiveGuestState | null;
  snapshot: ProjectSnapshot;
  displayName: string;
  cachedSession?: CachedLiveSessionRecord | null;
}) {
  const me = state?.participantId ?? cachedSession?.participantId ?? "";
  // The host may have numbered the name ("Gina 2") if someone else already uses it.
  const myName = state?.name ?? cachedSession?.name ?? displayName;
  const live = state?.status === "live";
  const role = state?.role ?? cachedSession?.role ?? "contribute";
  const canContribute = live && role === "contribute";
  const isOfflineCached = !live && !!cachedSession;
  const disabledReason = !live
    ? "Not connected to the host, so changes can't be saved right now."
    : role !== "contribute"
      ? "The host made this session view-only."
      : undefined;

  // Grades show immediately and roll back if the host refuses them.
  const [pendingGrades, setPendingGrades] = useState<Record<string, number>>({});
  useEffect(() => {
    setPendingGrades((pending) => {
      const next = { ...pending };
      for (const [optionId, value] of Object.entries(pending)) {
        const saved = snapshot.grades.find((g) => g.by === me && g.optionId === optionId);
        if (saved?.value === value) delete next[optionId];
      }
      return next;
    });
  }, [snapshot, me]);

  // New comments show at once, marked as sending, until the host's update includes them.
  const [pendingComments, setPendingComments] = useState<Comment[]>([]);
  useEffect(() => {
    setPendingComments((pending) =>
      pending.filter(
        (p) =>
          !snapshot.comments.some(
            (c) => c.by === me && c.optionId === p.optionId && c.body === p.body
          )
      )
    );
  }, [snapshot, me]);
  const comments = useMemo(
    () => [...snapshot.comments, ...pendingComments],
    [snapshot.comments, pendingComments]
  );
  const pendingIds = useMemo(() => new Set(pendingComments.map((c) => c.id)), [pendingComments]);

  const addComment = (optionId: string, body: string) => {
    const pending: Comment = {
      id: `pending:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      by: me,
      byName: myName,
      optionId,
      body,
    };
    setPendingComments((p) => [...p, pending]);
    return submit([{ kind: "comment", optionId, body }]).catch((err) => {
      setPendingComments((p) => p.filter((c) => c.id !== pending.id));
      throw err;
    });
  };

  const submit = async (entries: GuestEntry[]) => {
    if (!guest || !live) {
      toast({
        title: "Not saved",
        description: "Not connected to the host, so changes can't be saved right now.",
        variant: "destructive",
      });
      return;
    }
    try {
      await guest.submit(entries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDisconnect = /disconnect|closed|lost/i.test(msg);
      toast({
        title: isDisconnect ? "Host disconnected" : "Not saved",
        description: isDisconnect ? "Host disconnected; submission not saved" : msg,
        variant: "destructive",
      });
      throw err;
    }
  };

  // Plugin values (e.g. seen marks) go to the host in batches, at most every 2 s, so they never
  // trip its rate limit; one "Not saved" toast per failed batch.
  const batcher = useMemo(
    () =>
      createBatcher<GuestEntry>(async (entries) => {
        if (!guest || !live) return;
        try {
          await guest.submit(entries);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isDisconnect = /disconnect|closed|lost/i.test(msg);
          toast({
            title: isDisconnect ? "Host disconnected" : "Not saved",
            description: isDisconnect ? "Host disconnected; submission not saved" : msg,
            variant: "destructive",
          });
          throw err;
        }
      }),
    [guest, live]
  );
  useEffect(() => () => batcher.dispose(), [batcher]);

  const options = useMemo(() => snapshot.options.filter((o) => o.status === "active"), [snapshot]);
  const stats = useMemo(
    () => computeOptionStats(snapshot.options, snapshot.grades, comments),
    [snapshot, comments]
  );
  const voting = snapshot.project.voting;
  const round = voting?.round ?? 1;
  const myBallot = snapshot.rankings.find((r) => r.by === me && (r.round ?? 1) === round);

  const [forkDialogOpen, setForkDialogOpen] = useState(false);

  return (
    <OptionExtensionsProvider
      viewerId={me || null}
      isOwner={false}
      options={snapshot.options}
      properties={snapshot.properties}
      appendProperties={(entries) =>
        batcher.add(
          entries.map((e) => {
            // The host adds the guest's own id to a reset.
            if (e.kind !== "reset") return e as GuestEntry;
            const { participantId: _self, ...rest } = e;
            return rest as GuestEntry;
          })
        )
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={state?.status ?? "connecting"}
                isOfflineCached={isOfflineCached}
                lastSyncedAt={cachedSession?.lastSyncedAt}
              />
              <span className="text-xs text-muted-foreground">{`You're ${myName}`}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setForkDialogOpen(true)}
              leftIcon={<Copy className="h-4 w-4" aria-hidden />}
            >
              Save to my workspace
            </Button>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {snapshot.project.title}
          </h2>
          {snapshot.project.description && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {snapshot.project.description}
            </p>
          )}
        </header>

        <ForkSessionDialog
          open={forkDialogOpen}
          onOpenChange={setForkDialogOpen}
          snapshot={snapshot}
        />

        {isOfflineCached && (
          <Banner icon={<WifiOff className="h-4 w-4" />}>
            Host offline • Last synced{" "}
            {cachedSession?.lastSyncedAt
              ? new Date(cachedSession.lastSyncedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "earlier"}
          </Banner>
        )}

        {live && role === "view" && (
          <Banner icon={<Eye className="h-4 w-4" />}>The host made this session view-only.</Banner>
        )}

        {state?.status === "reconnecting" && (
          <Banner icon={<Loader2 className="h-4 w-4 motion-safe:animate-spin" />} live>
            Lost the connection to the host. Reconnecting…
          </Banner>
        )}
        {(state?.status === "ended" || state?.status === "failed") && (
          <Banner
            icon={<Unplug className="h-4 w-4" />}
            action={
              <div className="flex flex-wrap gap-2">
                {state.status === "failed" && guest && (
                  <Button size="sm" variant="outline" onClick={() => guest.retry()}>
                    Reconnect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadProjectExport(snapshot)}
                  leftIcon={<Download className="h-4 w-4" />}
                >
                  Save a copy
                </Button>
              </div>
            }
          >
            {state.message ?? "The session has ended."} This is the last state you received.
          </Banner>
        )}

        <section aria-labelledby="guest-options" className="space-y-2">
          <h3 id="guest-options" className="text-sm font-medium text-muted-foreground">
            Rate the options
          </h3>
          {disabledReason && live && (
            <p className="text-sm text-muted-foreground">{disabledReason}</p>
          )}
          <FilterableOptionList
            options={options}
            renderOption={(opt, index) => {
              const stat = stats.get(opt.id);
              const saved = snapshot.grades.find((g) => g.by === me && g.optionId === opt.id);
              return (
                <OptionRow
                  key={opt.id}
                  option={opt}
                  index={index}
                  averageGrade={stat?.average}
                  gradeCount={stat?.count}
                  commentCount={stat?.commentsCount}
                  myGrade={pendingGrades[opt.id] ?? saved?.value}
                  canGrade={canContribute}
                  timeTexts={{
                    ownGrade: ownGradeText({
                      optionId: opt.id,
                      viewerId: me || null,
                      grades: snapshot.grades,
                      history: snapshot.history,
                    }),
                    average: averageText({ optionId: opt.id, grades: snapshot.grades }),
                  }}
                  onGrade={(value) => {
                    setPendingGrades((p) => ({ ...p, [opt.id]: value }));
                    submit([
                      { kind: "grade", optionId: opt.id, value: value as 1 | 2 | 3 | 4 | 5 },
                    ]).catch(() =>
                      setPendingGrades((p) => {
                        const { [opt.id]: _dropped, ...rest } = p;
                        return rest;
                      })
                    );
                  }}
                  comments={
                    <CommentThread
                      compact
                      comments={comments}
                      pendingIds={pendingIds}
                      optionId={opt.id}
                      currentUserId={me}
                      isOwner={false}
                      disabled={!canContribute}
                      disabledReason={disabledReason}
                      onAddComment={(body) => addComment(opt.id, body)}
                      onEditComment={(commentId, body) =>
                        submit([{ kind: "comment", optionId: opt.id, body, replaces: commentId }])
                      }
                      onToggleHide={() => {}}
                    />
                  }
                />
              );
            }}
          />
        </section>

        {voting && (
          <section aria-label="Ballot" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DecidedBy snapshot={snapshot} />
              {(voting.liveResults || voting.state !== "open") && (
                <CompareStrategiesDialog snapshot={snapshot} canAdopt={false} triggeredBy={me} />
              )}
            </div>
            <RankBallot
              options={options}
              topN={voting.topN}
              initialRanking={myBallot?.ranking}
              disabled={!canContribute || voting.state !== "open"}
              disabledReason={voting.state !== "open" ? "Voting is closed." : disabledReason}
              onSubmitBallot={(ranking) => submit([{ kind: "ranking", ranking, round }])}
              submittedText={ballotText({
                viewerId: me || null,
                round,
                rankings: snapshot.rankings,
                history: snapshot.history,
              })}
            />
            <ResultsView
              outcomes={snapshot.outcomes}
              options={snapshot.options}
              rankings={snapshot.rankings}
              currentRound={round}
              liveResults={voting.liveResults}
              isOpen={voting.state === "open"}
            />
          </section>
        )}
      </div>
    </OptionExtensionsProvider>
  );
}

function StatusBadge({
  status,
  isOfflineCached = false,
  lastSyncedAt,
}: {
  status: LiveGuestState["status"];
  isOfflineCached?: boolean;
  lastSyncedAt?: string;
}) {
  if (status === "live") {
    return (
      <Badge variant="success" className="gap-1.5">
        <Radio className="h-3 w-3" aria-hidden />
        Live
      </Badge>
    );
  }
  if (isOfflineCached) {
    const timeStr = lastSyncedAt
      ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        <WifiOff className="h-3 w-3" aria-hidden />
        {timeStr ? `Host offline • Last synced ${timeStr}` : "Host offline"}
      </Badge>
    );
  }
  if (status === "reconnecting" || status === "connecting") {
    return <Badge variant="warning">Reconnecting</Badge>;
  }
  return <Badge variant="secondary">{status === "ended" ? "Ended" : "Disconnected"}</Badge>;
}

function Banner({
  icon,
  children,
  action,
  live = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  live?: boolean;
}) {
  return (
    <div
      role={live ? "status" : "alert"}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="m-0 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
          {icon}
        </span>
        <span>{children}</span>
      </p>
      {action}
    </div>
  );
}

function StatusCard({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="mx-auto mt-6 max-w-md text-center">
      <CardHeader className="items-center">
        <div
          className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden
        >
          {icon}
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
        {action && <div className="pt-3">{action}</div>}
      </CardHeader>
    </Card>
  );
}
