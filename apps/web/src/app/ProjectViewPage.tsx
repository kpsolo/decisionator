import type { Option } from "@decisionator/core";
import { computeOptionStats } from "@decisionator/core";
import type { ProjectRef, ProjectSnapshot } from "@decisionator/plugin-sdk";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentBrief } from "../features/agents/AgentBrief.js";
import { ContributionReview } from "../features/agents/ContributionReview.js";
import { CommentThread } from "../features/comments/CommentThread.js";
import { GradeInput } from "../features/grading/GradeInput.js";
import { OptionDetail } from "../features/grading/OptionDetail.js";
import { DeleteProject } from "../features/project/DeleteProject.js";
import { ExportButton } from "../features/project/ExportButton.js";
import { ProjectUnavailable } from "../features/project/ProjectUnavailable.js";
import { useRole } from "../features/project/useRole.js";
import { InPageShareModal } from "../features/sharing/InPageShareModal.js";
import { PasswordPrompt } from "../features/sharing/PasswordPrompt.js";
import { StatsView } from "../features/stats/StatsView.js";
import { useStorage } from "../storage/StorageContext.js";

export function ProjectViewPage() {
  const { fileId, storeId, id } = useParams();
  const navigate = useNavigate();
  const { storageManager } = useStorage();

  const effectiveId = id || fileId || "";
  const effectiveStoreId =
    storeId ||
    (effectiveId.startsWith("file_")
      ? "file"
      : effectiveId.startsWith("fs_")
        ? "firestore"
        : "google-sheets");

  const projectRef = useMemo<ProjectRef>(
    () => ({ store: effectiveStoreId, id: effectiveId }),
    [effectiveStoreId, effectiveId]
  );
  const store = storageManager.resolveStore(projectRef);

  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    reason: "deleted" | "trashed" | "permission_denied" | "not_found";
    details?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"options" | "stats" | "agents">("options");
  const [showInPageShare, setShowInPageShare] = useState(false);

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

    // Subscribe to watch updates
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
      <div className="card" style={{ textAlign: "center", padding: "40px 16px" }}>
        <h3>Loading project...</h3>
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

    // Optimistic update
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

  const baseProjectUrl = `/p/${effectiveStoreId}/${effectiveId}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header card */}
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: "0 0 6px 0" }}>{snapshot.project.title}</h2>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background:
                    effectiveStoreId === "file"
                      ? "rgba(16, 185, 129, 0.15)"
                      : effectiveStoreId === "firestore"
                        ? "rgba(245, 158, 11, 0.15)"
                        : "rgba(59, 130, 246, 0.15)",
                  color:
                    effectiveStoreId === "file"
                      ? "#065f46"
                      : effectiveStoreId === "firestore"
                        ? "#92400e"
                        : "#1e40af",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {effectiveStoreId}
              </span>
            </div>
            {snapshot.project.description && (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
                {snapshot.project.description}
              </p>
            )}
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
              Role: <strong>{snapshot.role}</strong> • {currentUser}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ExportButton snapshot={snapshot} />
            <DeleteProject
              fileId={effectiveId}
              projectTitle={snapshot.project.title}
              isOwner={isOwner}
              onDeleted={() => navigate("/")}
            />
          </div>
        </div>

        {/* Tab switch */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("options")}
            className={`btn ${activeTab === "options" ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 13 }}
          >
            Options & Grading ({snapshot.options.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stats")}
            className={`btn ${activeTab === "stats" ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 13 }}
          >
            Statistics & Distributions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("agents")}
            className={`btn ${activeTab === "agents" ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 13 }}
          >
            Ask Agent & Review ({snapshot.contributions?.length || 0})
          </button>
          <Link to={`${baseProjectUrl}/vote`} className="btn btn-outline" style={{ fontSize: 13 }}>
            Vote
          </Link>
          <Link
            to={`${baseProjectUrl}/results`}
            className="btn btn-outline"
            style={{ fontSize: 13 }}
          >
            Results
          </Link>
          <Link to={`${baseProjectUrl}/share`} className="btn btn-outline" style={{ fontSize: 13 }}>
            Share
          </Link>
          <button
            type="button"
            onClick={() => setShowInPageShare(true)}
            className="btn btn-outline"
            style={{
              fontSize: 13,
              borderColor: "var(--color-primary, #3b82f6)",
              color: "var(--color-primary, #3b82f6)",
            }}
          >
            📡 In-Page Live Share
          </button>
        </div>
      </div>

      {showInPageShare && (
        <InPageShareModal
          projectRef={projectRef}
          projectTitle={snapshot.project.title}
          store={store}
          onClose={() => setShowInPageShare(false)}
        />
      )}

      {/* Main Content */}
      {activeTab === "stats" ? (
        <StatsView
          stats={Array.from(statsMap.values())}
          showBordaSort={snapshot.outcomes.length > 0}
        />
      ) : activeTab === "agents" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {snapshot.options.map((opt) => {
            const stat = statsMap.get(opt.id);
            const myGrade = snapshot.grades.find(
              (g) => g.by === currentUser && g.optionId === opt.id
            );

            return (
              <div key={opt.id} className="card">
                <OptionDetail
                  option={opt}
                  averageGrade={stat?.average}
                  gradeCount={stat?.count}
                  commentCount={stat?.commentsCount}
                />
                <div
                  style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 12 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>My Rating:</strong>
                    <GradeInput
                      value={myGrade?.value}
                      optionId={opt.id}
                      authorName={currentUser}
                      updatedAt={myGrade?.at}
                      disabled={!roleCapabilities.canGrade}
                      onChange={(val) => handleGradeChange(opt.id, val)}
                    />
                  </div>

                  <CommentThread
                    comments={snapshot.comments}
                    optionId={opt.id}
                    currentUserId={currentUser}
                    isOwner={isOwner}
                    disabled={!roleCapabilities.canComment}
                    disabledReason={roleCapabilities.disabledReason}
                    onAddComment={(body) => handleAddComment(body, opt.id)}
                    onEditComment={(commentId, body) => handleEditComment(commentId, body, opt.id)}
                    onToggleHide={(commentId, hidden) =>
                      handleToggleHide(commentId, hidden, opt.id)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
