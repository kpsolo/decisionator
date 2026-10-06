import type { AuditEvent, Contribution } from "@decisionator/core";
import {
  Bot,
  Check,
  Edit3,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Textarea } from "../../components/ui/textarea.js";

export interface ContributionReviewProps {
  contributions: Contribution[];
  auditEvents?: AuditEvent[];
  onReviewAction: (
    contributionId: string,
    action: "accepted" | "edited" | "dismissed",
    editedBody?: string
  ) => void;
  isOwnerOrEditor?: boolean;
}

export const ContributionReview: React.FC<ContributionReviewProps> = ({
  contributions,
  auditEvents = [],
  onReviewAction,
  isOwnerOrEditor = true,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "dismissed">("all");

  const filtered = contributions.filter((c) => {
    if (filter === "all") return true;
    return c.reviewStatus === filter;
  });

  const handleStartEdit = (c: Contribution) => {
    setEditingId(c.id);
    setEditText(c.body);
  };

  const handleSaveEdit = (id: string) => {
    onReviewAction(id, "edited", editText);
    setEditingId(null);
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-agent" />
              Agent Contributions & Review (FR-043)
            </CardTitle>
            <CardDescription className="text-xs">
              Deliberate human review before incorporating agent suggestions into the decision
              state.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "pending", "accepted", "dismissed"] as const).map((status) => (
              <Button
                key={status}
                type="button"
                variant={filter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(status)}
                aria-pressed={filter === status}
                className="h-7 px-2.5 text-xs"
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No {filter !== "all" ? filter : ""} contributions yet.
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => {
              const isEditing = editingId === c.id;
              const isAgentAuthor = c.author.kind === "agent";
              const authorAttribution =
                c.author.kind === "agent"
                  ? `${c.author.agentName || "Agent"} on behalf of ${c.author.onBehalfOf || "user"}`
                  : c.by;

              return (
                <div
                  key={c.id}
                  className={`rounded-lg border p-4 transition-colors space-y-3 ${
                    c.reviewStatus === "pending"
                      ? "border-warning/40 bg-warning/5"
                      : c.reviewStatus === "accepted"
                        ? "border-success/40 bg-success/5"
                        : "border-border bg-card"
                  }`}
                >
                  {/* Header / Attribution */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {c.type.toUpperCase()}
                      </Badge>
                      <span className="text-muted-foreground">by</span>
                      {isAgentAuthor ? (
                        <Badge variant="agent" className="gap-1.5 px-2 py-0.5 text-[11px]">
                          <Bot className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{authorAttribution}</span>
                        </Badge>
                      ) : (
                        <span className="font-medium text-foreground">{authorAttribution}</span>
                      )}
                      <span className="text-muted-foreground">
                        • {new Date(c.at).toLocaleDateString()}
                      </span>
                    </div>

                    <Badge
                      variant={
                        c.reviewStatus === "pending"
                          ? "warning"
                          : c.reviewStatus === "accepted"
                            ? "success"
                            : c.reviewStatus === "edited"
                              ? "default"
                              : "secondary"
                      }
                      className="text-[11px] capitalize"
                    >
                      {c.reviewStatus}
                    </Badge>
                  </div>

                  {/* Body or Edit Box */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        aria-label="Edit contribution"
                        rows={4}
                        className="text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveEdit(c.id)}
                          className="h-7 text-xs"
                        >
                          Save & Mark Edited
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {c.body}
                    </p>
                  )}

                  {/* Pros & Cons */}
                  {c.pros && c.pros.length > 0 && (
                    <div className="flex items-start gap-1.5 text-xs text-success">
                      <ThumbsUp className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        <strong>Pros:</strong> {c.pros.join(", ")}
                      </div>
                    </div>
                  )}
                  {c.cons && c.cons.length > 0 && (
                    <div className="flex items-start gap-1.5 text-xs text-destructive">
                      <ThumbsDown className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        <strong>Cons:</strong> {c.cons.join(", ")}
                      </div>
                    </div>
                  )}

                  {/* Sources */}
                  {c.sources && c.sources.length > 0 && (
                    <div className="text-xs text-muted-foreground pt-1 flex flex-wrap items-center gap-1.5">
                      <strong>Sources:</strong>
                      {c.sources.map((s, idx) => (
                        <span key={s.url} className="inline-flex items-center gap-0.5">
                          {idx > 0 && ", "}
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-0.5"
                          >
                            {s.title || s.url}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Review Action Buttons */}
                  {isOwnerOrEditor && !isEditing && (
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-border/40">
                      {c.reviewStatus !== "accepted" && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onReviewAction(c.id, "accepted")}
                          className="h-7 text-xs"
                          leftIcon={<Check className="h-3.5 w-3.5" />}
                        >
                          Accept
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEdit(c)}
                        className="h-7 text-xs"
                        leftIcon={<Edit3 className="h-3.5 w-3.5" />}
                      >
                        Edit
                      </Button>
                      {c.reviewStatus !== "dismissed" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onReviewAction(c.id, "dismissed")}
                          className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                          leftIcon={<X className="h-3.5 w-3.5" />}
                        >
                          Dismiss
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Refused Actions Audit Log (FR-044) */}
        {auditEvents.length > 0 && (
          <div className="pt-4 border-t border-border space-y-2">
            <h4 className="text-xs font-semibold text-destructive flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" />
              Audit Log: Refused Agent Actions (FR-044)
            </h4>
            <div className="space-y-1.5">
              {auditEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs space-y-1"
                >
                  <div className="font-medium text-destructive flex items-center justify-between">
                    <span>{evt.type}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(evt.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground break-all">
                    {JSON.stringify(evt.details)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
