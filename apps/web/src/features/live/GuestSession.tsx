import { type Comment, computeOptionStats } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import {
  type GuestEntry,
  type LiveGuestState,
  type LiveShareGuest,
  joinSession,
} from "@decisionator/share-inpage";
import {
  Download,
  Link2Off,
  Loader2,
  Radio,
  RefreshCw,
  Unplug,
  Users,
  WifiOff,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
import { CommentThread } from "../comments/CommentThread.js";
import { OptionRow } from "../grading/OptionRow.js";
import { FilterableOptionList } from "../option-view/FilterableOptionList.js";
import { OptionExtensionsProvider } from "../option-view/OptionExtensionsProvider.js";
import { createBatcher } from "../option-view/batcher.js";
import { downloadProjectExport } from "../project/project-file.js";
import { RankBallot } from "../voting/RankBallot.js";
import { ResultsView } from "../voting/ResultsView.js";
import {
  guestDeviceSecret,
  loadNetworkConfig,
  saveGuestName,
  savedGuestName,
} from "./live-config.js";

/** `/join/:sessionId/:secret` — a guest joining a live session hosted in someone's tab. */
export function JoinLivePage() {
  const { sessionId, secret } = useParams();
  const [name, setName] = useState(savedGuestName);
  const [joinedAs, setJoinedAs] = useState<string | null>(null);
  const nameId = useId();

  if (!sessionId || !secret) {
    return (
      <Card className="mx-auto mt-6 max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Link2Off className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle>This join link is incomplete</CardTitle>
          <CardDescription>
            Ask the host to copy the link again or to show you the QR code. Links from older
            versions of Deci no longer work.
          </CardDescription>
        </CardHeader>
      </Card>
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

  return <GuestSession sessionId={sessionId} secret={secret} displayName={joinedAs} />;
}

function GuestSession({
  sessionId,
  secret,
  displayName,
}: {
  sessionId: string;
  secret: string;
  displayName: string;
}) {
  const [guest, setGuest] = useState<LiveShareGuest | null>(null);
  const [state, setState] = useState<LiveGuestState | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  useEffect(() => {
    let joined: ReturnType<typeof joinSession>;
    try {
      joined = joinSession({
        credentials: { sessionId, secret },
        deviceSecret: guestDeviceSecret(),
        displayName,
        config: loadNetworkConfig(),
      });
    } catch (err) {
      setUnsupported(err instanceof Error ? err.message : String(err));
      return;
    }
    const off = joined.guest.subscribe(setState);
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
  }, [sessionId, secret, displayName]);

  if (unsupported) {
    return (
      <StatusCard icon={<Unplug className="h-5 w-5" />} title="Can't join" body={unsupported} />
    );
  }
  if (!guest || !state) return null;

  if (!state.snapshot) {
    if (state.status === "failed") {
      return (
        <StatusCard
          icon={<WifiOff className="h-5 w-5" />}
          title="Couldn't connect"
          body={state.message ?? "The host could not be reached."}
          action={
            <Button onClick={() => guest.retry()} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Try again
            </Button>
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
      snapshot={state.snapshot}
      displayName={displayName}
    />
  );
}

function GuestWorkspace({
  guest,
  state,
  snapshot,
  displayName,
}: {
  guest: LiveShareGuest;
  state: LiveGuestState;
  snapshot: ProjectSnapshot;
  displayName: string;
}) {
  const me = state.participantId ?? "";
  // The host may have numbered the name ("Gina 2") if someone else already uses it.
  const myName = state.name ?? displayName;
  const live = state.status === "live";
  const canContribute = live && state.role === "contribute";
  const disabledReason = !live
    ? "Not connected to the host, so changes can't be saved right now."
    : state.role !== "contribute"
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
    try {
      await guest.submit(entries);
    } catch (err) {
      toast({
        title: "Not saved",
        description: err instanceof Error ? err.message : String(err),
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
        try {
          await guest.submit(entries);
        } catch (err) {
          toast({
            title: "Not saved",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
          throw err;
        }
      }),
    [guest]
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

  return (
    <OptionExtensionsProvider
      viewerId={me || null}
      isOwner={false}
      options={snapshot.options}
      properties={snapshot.properties}
      appendProperties={(entries) => batcher.add(entries as GuestEntry[])}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={state.status} />
            <span className="text-xs text-muted-foreground">{`You're ${myName}`}</span>
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

        {state.status === "reconnecting" && (
          <Banner icon={<Loader2 className="h-4 w-4 motion-safe:animate-spin" />} live>
            Lost the connection to the host. Reconnecting…
          </Banner>
        )}
        {(state.status === "ended" || state.status === "failed") && (
          <Banner
            icon={<Unplug className="h-4 w-4" />}
            action={
              <div className="flex flex-wrap gap-2">
                {state.status === "failed" && (
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
            <RankBallot
              options={options}
              topN={voting.topN}
              initialRanking={myBallot?.ranking}
              disabled={!canContribute || voting.state !== "open"}
              disabledReason={voting.state !== "open" ? "Voting is closed." : disabledReason}
              onSubmitBallot={(ranking) => submit([{ kind: "ranking", ranking, round }])}
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

function StatusBadge({ status }: { status: LiveGuestState["status"] }) {
  if (status === "live") {
    return (
      <Badge variant="success" className="gap-1.5">
        <Radio className="h-3 w-3" aria-hidden />
        Live
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
