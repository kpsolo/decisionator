import type { Option } from "@decisionator/core";
import { AlertCircle, ArrowLeft, Check, Edit2, Trash2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";

export interface PreviewEditorProps {
  initialTitle?: string;
  initialDescription?: string;
  initialOptions: Option[];
  onConfirm: (data: { title: string; description: string; options: Option[] }) => void;
  onBack: () => void;
}

export const PreviewEditor: React.FC<PreviewEditorProps> = ({
  initialTitle = "Untitled Decision",
  initialDescription = "",
  initialOptions,
  onConfirm,
  onBack,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Check duplicate titles
  const duplicateTitles = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const opt of options) {
      const lower = opt.title.trim().toLowerCase();
      if (seen.has(lower)) {
        dupes.add(lower);
      } else {
        seen.add(lower);
      }
    }
    return dupes;
  }, [options]);

  const handleRemoveOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id));
  };

  const handleUpdateOption = <K extends keyof Option>(id: string, field: K, value: Option[K]) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const handleAddOption = () => {
    const newId = `opt_${Date.now()}`;
    const newOpt: Option = {
      id: newId,
      title: "New Option",
      description: "",
      order: options.length + 1,
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    };
    setOptions((prev) => [...prev, newOpt]);
    setEditingId(newId);
  };

  const handleConfirm = () => {
    if (!title.trim() || options.length === 0) return;
    onConfirm({ title, description, options });
  };

  return (
    <Card className="border-border bg-card shadow-xs flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardHeader className="shrink-0 py-3.5 px-4 sm:px-6 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xl font-bold">Step 3: Review & Edit Project</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col space-y-3 sm:space-y-4 p-4 sm:p-6 overflow-hidden">
        {/* Project Metadata - pinned at top of card content */}
        <div className="shrink-0 space-y-2.5 rounded-lg border border-border bg-muted/20 p-3 sm:p-4">
          <div className="space-y-1">
            <label
              htmlFor="project-title-input"
              className="text-xs sm:text-sm font-semibold text-foreground"
            >
              Project Title *
            </label>
            <Input
              id="project-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Choose team retrospectives tool"
              className="bg-background text-sm sm:text-base h-9 sm:h-10"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="project-description-input"
              className="text-xs sm:text-sm font-semibold text-foreground"
            >
              Description (Optional)
            </label>
            <Textarea
              id="project-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context or decision criteria..."
              rows={2}
              className="bg-background text-xs sm:text-sm resize-none"
            />
          </div>
        </div>

        {duplicateTitles.size > 0 && (
          <div
            role="alert"
            className="shrink-0 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning font-medium"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Warning: Detected duplicate option titles! Consider renaming or merging them.
            </span>
          </div>
        )}

        {/* Options List with Inner Scroll */}
        <div className="flex-1 min-h-0 flex flex-col space-y-2">
          <div className="shrink-0 flex items-center justify-between">
            <h4 className="font-semibold text-sm">{`Options (${options.length})`}</h4>
            <Button type="button" variant="outline" size="sm" onClick={handleAddOption}>
              + Add Option
            </Button>
          </div>

          <div
            className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1.5 focus:outline-none rounded-lg border border-border/60 bg-muted/10 p-2 sm:p-3"
            aria-label="Options"
          >
            {options.map((opt, index) => {
              const isDupe = duplicateTitles.has(opt.title.trim().toLowerCase());
              const isEditing = editingId === opt.id;

              return (
                <div
                  key={opt.id}
                  className={`rounded-lg border p-3.5 transition-colors ${
                    isDupe
                      ? "border-warning/60 bg-warning/5"
                      : "border-border bg-card/60 hover:bg-accent/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Input
                            type="text"
                            value={opt.title}
                            onChange={(e) => handleUpdateOption(opt.id, "title", e.target.value)}
                            aria-label={`Option ${index + 1} title`}
                            className="bg-background text-sm font-medium"
                          />
                          <Textarea
                            value={opt.description || ""}
                            onChange={(e) =>
                              handleUpdateOption(opt.id, "description", e.target.value)
                            }
                            aria-label={`Option ${index + 1} description`}
                            placeholder="Description..."
                            rows={2}
                            className="bg-background text-xs resize-y"
                          />
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2">
                            <strong className="font-semibold text-sm text-foreground min-w-0 break-words">
                              {index + 1}. {opt.title}
                            </strong>
                            {isDupe && (
                              <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                                duplicate
                              </Badge>
                            )}
                          </div>
                          {opt.description && (
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              {opt.description}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(isEditing ? null : opt.id)}
                        className="h-8 px-2.5 text-xs"
                      >
                        {isEditing ? (
                          <span className="flex items-center gap-1 text-primary font-medium">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Done
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Edit2 className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                          </span>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveOption(opt.id)}
                        className="h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>

      <CardFooter className="shrink-0 flex items-center justify-end border-t border-border py-3 px-4 sm:px-6 bg-card">
        <Button
          type="button"
          variant="default"
          onClick={handleConfirm}
          disabled={!title.trim() || options.length === 0}
        >
          Create Project &rarr;
        </Button>
      </CardFooter>
    </Card>
  );
};

export default PreviewEditor;
