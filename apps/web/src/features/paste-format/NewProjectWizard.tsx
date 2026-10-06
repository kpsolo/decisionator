import type { Option } from "@decisionator/core";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { toast } from "../../components/ui/use-toast.js";
import { PreviewEditor } from "../preview/PreviewEditor.js";
import { createProjectFlow } from "../project/createProject.js";
import { FormatStep } from "./FormatStep.js";
import { PasteStep } from "./PasteStep.js";
import { type DraftState, clearDraftState, loadDraftState, saveDraftState } from "./draft.js";
import type { ProjectMeta } from "./options-json.js";

type WizardStep = "paste" | "format" | "preview";

const DEFAULT_TITLE = "Untitled Decision";

export function NewProjectWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>("paste");
  const [pastedText, setPastedText] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // Bumped to remount the steps, which keep their own copy of the initial props.
  const [draftVersion, setDraftVersion] = useState(0);

  useEffect(() => {
    loadDraftState().then((draft) => {
      if (draft) {
        setPastedText(draft.pastedText);
        setAiAnswer(draft.aiAnswer);
        setOptions(draft.options);
        setTitle(draft.title);
        setDescription(draft.description);
        if (draft.options.length > 0) {
          setStep("preview");
        } else if (draft.pastedText) {
          setStep("paste");
        }
        setDraftVersion((v) => v + 1);
      }
    });
  }, []);

  const persist = (patch: Partial<DraftState>) =>
    saveDraftState({ title, description, pastedText, aiAnswer, options, ...patch });

  const hasDraft = pastedText.trim() !== "" || aiAnswer.trim() !== "" || options.length > 0;

  const handleFormatWithAi = (text: string) => {
    setPastedText(text);
    persist({ pastedText: text });
    setStep("format");
  };

  const handleUsePlainList = (plainOptions: Option[]) => {
    setOptions(plainOptions);
    setAiAnswer("");
    setTitle(DEFAULT_TITLE);
    setDescription("");
    persist({ aiAnswer: "", options: plainOptions, title: DEFAULT_TITLE, description: "" });
    setStep("preview");
  };

  const goToPreview = (
    next: Option[],
    project: ProjectMeta | undefined,
    patch: Partial<DraftState>
  ) => {
    const nextTitle = project?.title || DEFAULT_TITLE;
    const nextDescription = project?.description || "";
    setOptions(next);
    setTitle(nextTitle);
    setDescription(nextDescription);
    persist({ ...patch, options: next, title: nextTitle, description: nextDescription });
    setDraftVersion((v) => v + 1);
    setStep("preview");
  };

  // Options JSON pasted in step 1 (e.g. from an agent) skips the AI round-trip entirely.
  const handleUseJson = (jsonOptions: Option[], rawText: string, project?: ProjectMeta) => {
    setPastedText(rawText);
    setAiAnswer("");
    goToPreview(jsonOptions, project, { pastedText: rawText, aiAnswer: "" });
  };

  const handleValidAiOptions = (validated: Option[], rawAnswer: string, project?: ProjectMeta) => {
    setAiAnswer(rawAnswer);
    goToPreview(validated, project, { aiAnswer: rawAnswer });
  };

  const handleClearDraft = async () => {
    await clearDraftState();
    setPastedText("");
    setAiAnswer("");
    setOptions([]);
    setTitle(DEFAULT_TITLE);
    setDescription("");
    setError(null);
    setStep("paste");
    setDraftVersion((v) => v + 1);
    setConfirmClearOpen(false);
    toast({ title: "Draft cleared", description: "Start a new project from scratch." });
  };

  const handleConfirmProject = async (data: {
    title: string;
    description: string;
    options: Option[];
  }) => {
    try {
      setLoading(true);
      setError(null);
      const res = await createProjectFlow({
        title: data.title,
        description: data.description,
        options: data.options,
      });
      await clearDraftState();
      navigate(`/p/${res.storeId}/${res.fileId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const stepsConfig: { id: WizardStep; label: string; number: number }[] = [
    { id: "paste", label: "Paste Ideas", number: 1 },
    { id: "format", label: "Format & Parse", number: 2 },
    { id: "preview", label: "Preview Options", number: 3 },
  ];

  const currentStepIndex = stepsConfig.findIndex((s) => s.id === step);
  // On the plain-list path the Format step is skipped, so it is never shown as completed.
  const formatSkipped = step === "preview" && !aiAnswer;

  if (loading) {
    return (
      <Card className="text-center py-16">
        <CardContent className="flex flex-col items-center justify-center space-y-4">
          <div
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent motion-reduce:animate-none"
          />
          <h3 className="text-xl font-bold tracking-tight">Creating decision project...</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Initializing project and saving options in your active storage.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Wizard step progress (display only) */}
        <nav aria-label="Creation progress" className="min-w-0 flex-1">
          <ol className="flex items-center justify-between gap-2 overflow-x-auto p-2 rounded-lg bg-card border border-border shadow-xs">
            {stepsConfig.map((s, idx) => {
              const isCurrent = idx === currentStepIndex;
              const isDone = idx < currentStepIndex && !(s.id === "format" && formatSkipped);
              return (
                <React.Fragment key={s.id}>
                  <li
                    aria-current={isCurrent ? "step" : undefined}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium ${
                      isCurrent
                        ? "bg-primary-solid text-primary-foreground font-semibold shadow-xs"
                        : isDone
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        isCurrent
                          ? "bg-primary-foreground text-primary-solid font-bold"
                          : isDone
                            ? "bg-success-solid text-success-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isDone ? <Check className="h-3 w-3" /> : s.number}
                    </span>
                    <span>{s.label}</span>
                  </li>
                  {idx < stepsConfig.length - 1 && (
                    <li aria-hidden="true" className="flex items-center">
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </nav>
        {hasDraft && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmClearOpen(true)}
            leftIcon={<RotateCcw className="h-4 w-4" />}
            className="self-end sm:self-auto"
          >
            Clear draft
          </Button>
        )}
      </div>

      <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear this draft?</DialogTitle>
            <DialogDescription>
              This removes the pasted text
              {aiAnswer ? ", the AI answer" : ""}
              {options.length > 0
                ? ` and ${options.length} ${options.length === 1 ? "option" : "options"}`
                : ""}
              . It can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmClearOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleClearDraft}>
              Clear draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive font-medium shadow-xs"
        >
          {error}
        </div>
      )}

      {step === "paste" && (
        <PasteStep
          key={draftVersion}
          initialText={pastedText}
          onFormatWithAi={handleFormatWithAi}
          onUsePlainList={handleUsePlainList}
          onUseJson={handleUseJson}
        />
      )}

      {step === "format" && (
        <FormatStep
          key={draftVersion}
          pastedText={pastedText}
          initialAiAnswer={aiAnswer}
          onValidOptions={handleValidAiOptions}
          onBack={() => setStep("paste")}
        />
      )}

      {step === "preview" && (
        <PreviewEditor
          key={draftVersion}
          initialTitle={title}
          initialDescription={description}
          initialOptions={options}
          onConfirm={handleConfirmProject}
          onBack={() => setStep(aiAnswer ? "format" : "paste")}
        />
      )}
    </div>
  );
}

export default NewProjectWizard;
