import { computeOptionStats } from "@decisionator/core";
import type { ProjectRef, ProjectSnapshot } from "@decisionator/plugin-sdk";
import {
  BarChart3,
  Bot,
  Download,
  Eye,
  FileSpreadsheet,
  Layers,
  MoreHorizontal,
  Radio,
  Share2,
  SlidersHorizontal,
  Trash2,
  Vote,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader } from "../components/ui/card.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { AgentBrief } from "../features/agents/AgentBrief.js";
import { ContributionReview } from "../features/agents/ContributionReview.js";
import { CommentThread } from "../features/comments/CommentThread.js";
import { OptionRow } from "../features/grading/OptionRow.js";
import { useLiveShare } from "../features/live/LiveShareContext.js";
import { DeleteProject } from "../features/project/DeleteProject.js";
import { ProjectUnavailable } from "../features/project/ProjectUnavailable.js";
import { SkippedRowsNotice } from "../features/project/SkippedRowsNotice.js";
import { downloadProjectExport } from "../features/project/project-file.js";
import { useProjectStore } from "../features/project/useProjectStore.js";
import { useRole } from "../features/project/useRole.js";
import { PasswordPrompt } from "../features/sharing/PasswordPrompt.js";
import { StatsView } from "../features/stats/StatsView.js";

export function ProjectViewPage() {
  const navigate = useNavigate();
  const {
    projectId: effectiveId,
    storeId: effectiveStoreId,
    projectRef,
    store,
    baseUrl: baseProjectUrl,
  } = useProjectStore();

  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    reason: "deleted" | "trashed" | "permission_denied" | "not_found";
    details?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<string>("options");
  const live = useLiveShare();
  const [showDelete, setShowDelete] = useState(false);

  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [cachedPassword, setCachedPassword] = useState<string | undefined>();

  useEffect(() => {
    if (!effectiveId) return;

    let isMounted = true;
    async function load() {
      try {
        setLoading(true);
        const identity = await store.signIn({ interactive: false });
        if (isMounted) setCurrentUser(identity.participantId);

        const snap = await store.openProject(projectRef, { password: cachedPassword });
        if (isMounted) {
          setSnapshot(snap);
          setNeedsPassword(false);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Password required") || msg.includes("Incorrect password")) {
          setNeedsPassword(true);
          setPasswordError(msg);
        } else if (msg.includes("trashed")) {
          setError({ reason: "trashed", details: msg });
        } else if (msg.includes("PERMISSION_DENIED") || msg.includes("insufficientPermissions")) {
          setError({ reason: "permission_denied", details: msg });
        } else {
          setError({ reason: "not_found", details: msg });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    const unsub = store.watch(projectRef, (newSnap) => {
      if (isMounted) setSnapshot(newSnap);
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, [effectiveId, cachedPassword, store, projectRef]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
        </Card>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <PasswordPrompt
        error={passwordError}
        onUnlock={async (pwd) => {
          try {
            setLoading(true);
            const snap = await store.openProject(projectRef, { password: pwd });
            setCachedPassword(pwd);
            setSnapshot(snap);
            setNeedsPassword(false);
            return true;
          } catch {
            return false;
          } finally {
            setLoading(false);
          }
        }}
      />
    );
  }

  if (error) {
    return <ProjectUnavailable reason={error.reason} details={error.details} />;
  }

  if (!snapshot || !effectiveId) {
    return <ProjectUnavailable reason="not_found" />;
  }

  const isOwner = snapshot.role === "owner";
  const roleCapabilities = useRole(snapshot.role);
  const statsMap = computeOptionStats(snapshot.options, snapshot.grades, snapshot.comments);

  const handleGradeChange = async (optionId: string, val: number) => {
    if (!effectiveId) return;
    const gradeVal = val as 1 | 2 | 3 | 4 | 5;

    const newGrades = [
      ...snapshot.grades.filter((g) => !(g.by === currentUser && g.optionId === optionId)),
      {
        id: `g_opt_${Date.now()}`,
        at: new Date().toISOString(),
        by: currentUser,
        optionId,
        value: gradeVal,
      },
    ];
    setSnapshot({ ...snapshot, grades: newGrades });

    await store.append(projectRef, [{ kind: "grade", optionId, value: gradeVal }]);
  };

  const handleAddComment = async (body: string, optionId: string) => {
    const newComments = [
      ...snapshot.comments,
      {
        id: `c_opt_${Date.now()}`,
        at: new Date().toISOString(),
        by: currentUser,
        optionId,
        body,
      },
    ];
    setSnapshot({ ...snapshot, comments: newComments });

    await store.append(projectRef, [{ kind: "comment", optionId, body }]);
  };

  const handleEditComment = async (commentId: string, newBody: string, optionId: string) => {
    await store.append(projectRef, [
      { kind: "comment", optionId, body: newBody, replaces: commentId },
    ]);

    const updated = snapshot.comments.map((c) =>
      c.id === commentId ? { ...c, body: newBody, replaces: commentId } : c
    );
    setSnapshot({ ...snapshot, comments: updated });
  };

  const handleToggleHide = async (commentId: string, hidden: boolean, optionId: string) => {
    await store.append(projectRef, [
      { kind: "comment", optionId, body: "", replaces: commentId, hidden },
    ]);

    const updated = snapshot.comments.map((c) => (c.id === commentId ? { ...c, hidden } : c));
    setSnapshot({ ...snapshot, comments: updated });
  };

  const handleReviewAction = async (
    actionId: string,
    action: "accepted" | "edited" | "dismissed",
    editedBody?: string
  ) => {
    if (!effectiveId) return;
    const existing = (snapshot.contributions || []).find((c) => c.id === actionId);
    if (!existing) return;
    const updated = {
      ...existing,
      reviewStatus: action,
      body: editedBody !== undefined ? editedBody : existing.body,
    };

    await store.append(projectRef, [{ kind: "contribution", contribution: updated }]);

    const newContribs = (snapshot.contributions || []).map((c) =>
      c.id === actionId ? updated : c
    );
    setSnapshot({ ...snapshot, contributions: newContribs });
  };

  const storeLabel =
    effectiveStoreId === "file"
      ? "Local file"
      : effectiveStoreId === "firestore"
        ? "Firestore"
        : "Google Sheets";

  return (
    <div className="space-y-6">
      {/* Workspace header: sticky at top with backdrop blur */}
      <header className="sticky top-14 md:top-0 z-30 -mt-6 sm:-mt-8 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 border-b border-border shadow-xs transition-shadow">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
              {snapshot.project.title}
            </h2>
            {snapshot.project.description && (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground line-clamp-2">
                {snapshot.project.description}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{storeLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{`Role: ${snapshot.role}`}</span>
              <span aria-hidden="true">·</span>
              <span className="[overflow-wrap:anywhere]">{currentUser}</span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" asChild leftIcon={<Vote className="h-3.5 w-3.5" />}>
              <Link to={`${baseProjectUrl}/vote`}>Vote</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              leftIcon={<BarChart3 className="h-3.5 w-3.5" />}
            >
              <Link to={`${baseProjectUrl}/results`}>Results</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              leftIcon={<Share2 className="h-3.5 w-3.5" />}
            >
              <Link to={`${baseProjectUrl}/share`}>Share</Link>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="More project actions"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {isOwner && (
                  <DropdownMenuItem
                    onSelect={() =>
                      live.openFor({ store, projectRef, projectTitle: snapshot.project.title })
                    }
                  >
                    <Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Live session…
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => downloadProjectExport(snapshot)}>
                  <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Export Project (JSON)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => downloadProjectExport(snapshot, "xlsx")}>
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Export Project (Excel / Google Sheets)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setShowDelete(true)}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {isOwner ? "Delete Project..." : "Remove from my list"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <SkippedRowsNotice warnings={snapshot.warnings} />

      <DeleteProject
        hideTrigger
        store={store}
        projectRef={projectRef}
        open={showDelete}
        onOpenChange={setShowDelete}
        fileId={effectiveId}
        projectTitle={snapshot.project.title}
        isOwner={isOwner}
        onDeleted={() => navigate("/")}
      />

      {/* Tabs Navigation & Views */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="options" className="text-xs sm:text-sm">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{`Options & Grading (${snapshot.options.length})`}</span>
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-xs sm:text-sm">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Statistics & Distributions</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="text-xs sm:text-sm">
            <Bot className="h-3.5 w-3.5 text-agent" aria-hidden="true" />
            <span>{`Ask Agent & Review (${snapshot.contributions?.length || 0})`}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="options" className="space-y-3 mt-0">
          {!roleCapabilities.canGrade && roleCapabilities.disabledReason && (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
              <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{roleCapabilities.disabledReason}</span>
            </p>
          )}

          <ul className="space-y-3" aria-label="Options">
            {snapshot.options.map((opt, index) => {
              const stat = statsMap.get(opt.id);
              const myGrade = snapshot.grades.find(
                (g) => g.by === currentUser && g.optionId === opt.id
              );

              return (
                <OptionRow
                  key={opt.id}
                  option={opt}
                  index={index}
                  averageGrade={stat?.average}
                  gradeCount={stat?.count}
                  commentCount={stat?.commentsCount}
                  myGrade={myGrade?.value}
                  canGrade={roleCapabilities.canGrade}
                  onGrade={(val) => handleGradeChange(opt.id, val)}
                  comments={
                    <CommentThread
                      compact
                      comments={snapshot.comments}
                      optionId={opt.id}
                      currentUserId={currentUser}
                      isOwner={isOwner}
                      disabled={!roleCapabilities.canComment}
                      disabledReason={roleCapabilities.disabledReason}
                      onAddComment={(body) => handleAddComment(body, opt.id)}
                      onEditComment={(commentId, body) =>
                        handleEditComment(commentId, body, opt.id)
                      }
                      onToggleHide={(commentId, hidden) =>
                        handleToggleHide(commentId, hidden, opt.id)
                      }
                    />
                  }
                />
              );
            })}
          </ul>
        </TabsContent>

        <TabsContent value="stats" className="mt-0">
          <StatsView
            stats={Array.from(statsMap.values())}
            showBordaSort={snapshot.outcomes.length > 0}
          />
        </TabsContent>

        <TabsContent value="agents" className="space-y-4 mt-0">
          <AgentBrief
            projectTitle={snapshot.project.title}
            target={{ kind: "project" }}
            token="deci_agent_token_local"
            instruction={`Analyze project "${snapshot.project.title}" and provide notes, research, pros/cons or proposed options.`}
            expiresAt={new Date(Date.now() + 24 * 3600 * 1000).toISOString()}
          />
          <ContributionReview
            contributions={snapshot.contributions || []}
            onReviewAction={handleReviewAction}
            isOwnerOrEditor={roleCapabilities.canComment}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ProjectViewPage;
