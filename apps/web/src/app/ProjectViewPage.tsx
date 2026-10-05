import type { Option } from "@decisionator/core";
import { computeOptionStats } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { GoogleAuthService, GoogleSheetsProjectStore } from "@decisionator/store-google-sheets";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getGoogleConfig } from "../config/google.js";
import { CommentThread } from "../features/comments/CommentThread.js";
import { GradeInput } from "../features/grading/GradeInput.js";
import { OptionDetail } from "../features/grading/OptionDetail.js";
import { DeleteProject } from "../features/project/DeleteProject.js";
import { ExportButton } from "../features/project/ExportButton.js";
import { ProjectUnavailable } from "../features/project/ProjectUnavailable.js";
import { useRole } from "../features/project/useRole.js";
import { PasswordPrompt } from "../features/sharing/PasswordPrompt.js";
import { StatsView } from "../features/stats/StatsView.js";

export function ProjectViewPage() {
  const { fileId } = useParams();
  const navigate = useNavigate();

  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    reason: "deleted" | "trashed" | "permission_denied" | "not_found";
    details?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"options" | "stats">("options");

  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [cachedPassword, setCachedPassword] = useState<string | undefined>();

  useEffect(() => {
    if (!fileId) return;

    let isMounted = true;
    const config = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: config.clientId });
    const store = new GoogleSheetsProjectStore(auth);

    const validFileId = fileId;
    async function load() {
      try {
        setLoading(true);
        const identity = await store.signIn({ interactive: false });
        if (isMounted) setCurrentUser(identity.participantId);

        const snap = await store.openProject(
          { store: "google-sheets", id: validFileId },
          { password: cachedPassword }
        );
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
    const unsub = store.watch({ store: "google-sheets", id: fileId }, (newSnap) => {
      if (isMounted) setSnapshot(newSnap);
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, [fileId, cachedPassword]);

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
            const cfg = getGoogleConfig();
            const a = new GoogleAuthService({ clientId: cfg.clientId });
            const s = new GoogleSheetsProjectStore(a);
            const snap = await s.openProject(
              { store: "google-sheets", id: fileId || "" },
              { password: pwd }
            );
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

  if (!snapshot || !fileId) {
    return <ProjectUnavailable reason="not_found" />;
  }

  const isOwner = snapshot.role === "owner";
  const roleCapabilities = useRole(snapshot.role);
  const statsMap = computeOptionStats(snapshot.options, snapshot.grades, snapshot.comments);

  const handleGradeChange = async (optionId: string, val: number) => {
    if (!fileId) return;
    const gradeVal = val as 1 | 2 | 3 | 4 | 5;
    const config = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: config.clientId });
    const store = new GoogleSheetsProjectStore(auth);

    await store.append({ store: "google-sheets", id: fileId }, [
      { kind: "grade", optionId, value: gradeVal },
    ]);

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
  };

  const handleAddComment = async (body: string, optionId: string) => {
    const config = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: config.clientId });
    const store = new GoogleSheetsProjectStore(auth);

    await store.append({ store: "google-sheets", id: fileId }, [
      { kind: "comment", optionId, body },
    ]);

    // Optimistic update
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
  };

  const handleEditComment = async (commentId: string, newBody: string, optionId: string) => {
    const config = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: config.clientId });
    const store = new GoogleSheetsProjectStore(auth);

    await store.append({ store: "google-sheets", id: fileId }, [
      { kind: "comment", optionId, body: newBody, replaces: commentId },
    ]);

    const updated = snapshot.comments.map((c) =>
      c.id === commentId ? { ...c, body: newBody, replaces: commentId } : c
    );
    setSnapshot({ ...snapshot, comments: updated });
  };

  const handleToggleHide = async (commentId: string, hidden: boolean, optionId: string) => {
    const config = getGoogleConfig();
    const auth = new GoogleAuthService({ clientId: config.clientId });
    const store = new GoogleSheetsProjectStore(auth);

    await store.append({ store: "google-sheets", id: fileId }, [
      { kind: "comment", optionId, body: "", replaces: commentId, hidden },
    ]);

    const updated = snapshot.comments.map((c) => (c.id === commentId ? { ...c, hidden } : c));
    setSnapshot({ ...snapshot, comments: updated });
  };

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
            <h2 style={{ margin: "0 0 6px 0" }}>{snapshot.project.title}</h2>
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
              fileId={fileId}
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
          <Link to={`/p/${fileId}/share`} className="btn btn-outline" style={{ fontSize: 13 }}>
            Share Link
          </Link>
        </div>
      </div>

      {/* Main Content */}
      {activeTab === "stats" ? (
        <StatsView stats={Array.from(statsMap.values())} />
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
                    onEditComment={(cId, body) => handleEditComment(cId, body, opt.id)}
                    onToggleHide={(cId, hidden) => handleToggleHide(cId, hidden, opt.id)}
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
