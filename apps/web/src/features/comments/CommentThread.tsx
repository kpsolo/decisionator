import type { Comment } from "@decisionator/core";
import DOMPurify from "dompurify";
import { MessageSquare, Send } from "lucide-react";
import MarkdownIt from "markdown-it";
import type React from "react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

export interface CommentThreadProps {
  comments: Comment[];
  optionId: string;
  currentUserId: string;
  isOwner: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onAddComment: (body: string) => void;
  onEditComment: (commentId: string, newBody: string) => void;
  onToggleHide: (commentId: string, hidden: boolean) => void;
  /** Embedded under an option row: no heading (the toggle shows the count) and a lighter form. */
  compact?: boolean;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export const CommentThread: React.FC<CommentThreadProps> = ({
  comments,
  optionId,
  currentUserId,
  isOwner,
  disabled = false,
  disabledReason,
  onAddComment,
  onEditComment,
  onToggleHide,
  compact = false,
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
    <div className={compact ? "space-y-2.5" : "space-y-3 pt-3"}>
      {!compact && (
        <h5 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{`Comments (${optionComments.length})`}</span>
        </h5>
      )}

      {compact && optionComments.length === 0 && (
        <p className="text-xs text-muted-foreground">No comments yet.</p>
      )}

      <div className="space-y-2.5">
        {optionComments.map((comment) => {
          if (comment.hidden && !isOwner) {
            return (
              <div
                key={comment.id}
                className="p-2.5 rounded-md bg-muted/30 italic text-xs text-muted-foreground"
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
              className={`rounded-lg border p-3 text-sm transition-colors ${
                comment.hidden
                  ? "border-destructive/30 bg-destructive/5 opacity-75"
                  : "border-border bg-card/40 hover:bg-card"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-foreground">
                    {comment.byName ?? comment.by}
                  </span>
                  {comment.byName && <span className="text-[11px]">(live guest)</span>}
                  <span aria-hidden="true">•</span>
                  <span>{new Date(comment.at).toLocaleString()}</span>
                  {comment.replaces && <span className="italic text-[11px]">(edited)</span>}
                  {comment.hidden && (
                    <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                      HIDDEN
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {isAuthor && !isEditing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(comment)}
                      className="h-6 px-2 text-xs"
                    >
                      Edit
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onToggleHide(comment.id, !comment.hidden)}
                      className="h-6 px-2 text-xs"
                    >
                      {comment.hidden ? "Unhide" : "Hide"}
                    </Button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="space-y-2 pt-1">
                  <Textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    aria-label="Edit comment"
                    maxLength={10000}
                    rows={3}
                    className="text-xs bg-background"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingId(null)}
                      className="h-7 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => handleSaveEdit(comment.id)}
                      className="h-7 text-xs"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed text-foreground [&>p]:m-0"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized via DOMPurify
                  dangerouslySetInnerHTML={renderMarkdown(comment.body)}
                />
              )}
            </div>
          );
        })}
      </div>

      {disabled && disabledReason && (
        <p className="text-xs text-muted-foreground italic pt-1">{disabledReason}</p>
      )}

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="space-y-2 pt-1">
        <Textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          aria-label="Add a comment"
          placeholder={
            disabled
              ? "Commenting disabled for view-only access"
              : "Add a comment (Markdown supported)..."
          }
          rows={compact ? 2 : 3}
          maxLength={10000}
          disabled={disabled}
          className="text-xs bg-background"
        />
        <div className="flex items-center justify-end">
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={disabled || !newBody.trim() || newBody.length > 10000}
            leftIcon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
            className="h-8 text-xs"
          >
            Post Comment
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CommentThread;
