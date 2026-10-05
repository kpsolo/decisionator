import type { Comment } from "@decisionator/core";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import type React from "react";
import { useMemo, useState } from "react";

export interface CommentThreadProps {
  comments: Comment[];
  optionId: string;
  currentUserId: string;
  isOwner: boolean;
  onAddComment: (body: string) => void;
  onEditComment: (commentId: string, newBody: string) => void;
  onToggleHide: (commentId: string, hidden: boolean) => void;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export const CommentThread: React.FC<CommentThreadProps> = ({
  comments,
  optionId,
  currentUserId,
  isOwner,
  onAddComment,
  onEditComment,
  onToggleHide,
}) => {
  const [newBody, setNewBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const optionComments = useMemo(() => {
    return comments.filter((c) => c.optionId === optionId);
  }, [comments, optionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBody.trim() || newBody.length > 10000) return;
    onAddComment(newBody.trim());
    setNewBody("");
  };

  const handleStartEdit = (comment: Comment) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
  };

  const handleSaveEdit = (commentId: string) => {
    if (!editBody.trim() || editBody.length > 10000) return;
    onEditComment(commentId, editBody.trim());
    setEditingId(null);
  };

  const renderMarkdown = (text: string) => {
    const rawHtml = md.render(text);
    return { __html: DOMPurify.sanitize(rawHtml) };
  };

  return (
    <div className="comment-thread" style={{ marginTop: 16 }}>
      <h5 style={{ margin: "0 0 12px 0" }}>Comments ({optionComments.length})</h5>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {optionComments.map((comment) => {
          if (comment.hidden && !isOwner) {
            return (
              <div
                key={comment.id}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--card-bg)",
                  fontStyle: "italic",
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                (This comment was hidden by the owner)
              </div>
            );
          }

          const isAuthor = comment.by === currentUserId;
          const isEditing = editingId === comment.id;

          return (
            <div
              key={comment.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "10px 12px",
                background: comment.hidden ? "rgba(220, 38, 38, 0.05)" : "var(--bg)",
                opacity: comment.hidden ? 0.75 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 6,
                }}
              >
                <span>
                  <strong>{comment.by}</strong> • {new Date(comment.at).toLocaleString()}
                  {comment.replaces && " (edited)"}
                  {comment.hidden && " [HIDDEN]"}
                </span>

                <div style={{ display: "flex", gap: 6 }}>
                  {isAuthor && !isEditing && (
                    <button
                      type="button"
                      onClick={() => handleStartEdit(comment)}
                      className="btn btn-outline"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                    >
                      Edit
                    </button>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => onToggleHide(comment.id, !comment.hidden)}
                      className="btn btn-outline"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                    >
                      {comment.hidden ? "Unhide" : "Hide"}
                    </button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    style={{
                      width: "100%",
                      padding: 6,
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--card-bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                      fontSize: 13,
                    }}
                  />
                  <div
                    style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}
                  >
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="btn btn-outline"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(comment.id)}
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="comment-body"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized via DOMPurify
                  dangerouslySetInnerHTML={renderMarkdown(comment.body)}
                  style={{ fontSize: 13, lineHeight: 1.5 }}
                />
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit}>
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Add a comment (Markdown supported)..."
          rows={3}
          maxLength={10000}
          style={{
            width: "100%",
            padding: 8,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            boxSizing: "border-box",
            fontSize: 13,
            marginBottom: 8,
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            disabled={!newBody.trim() || newBody.length > 10000}
          >
            Post Comment
          </button>
        </div>
      </form>
    </div>
  );
};
