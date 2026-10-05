import type { Option } from "@decisionator/core";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PreviewEditor } from "../preview/PreviewEditor.js";
import { createProjectFlow } from "../project/createProject.js";
import { FormatStep } from "./FormatStep.js";
import { PasteStep } from "./PasteStep.js";
import { clearDraftState, loadDraftState, saveDraftState } from "./draft.js";

export function NewProjectWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"paste" | "format" | "preview">("paste");
  const [pastedText, setPastedText] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore draft on mount
  useEffect(() => {
    loadDraftState().then((draft) => {
      if (draft) {
        setPastedText(draft.pastedText);
        setAiAnswer(draft.aiAnswer);
        setOptions(draft.options);
        if (draft.options.length > 0) {
          setStep("preview");
        } else if (draft.pastedText) {
          setStep("paste");
        }
      }
    });
  }, []);

  const handleFormatWithAi = (text: string) => {
    setPastedText(text);
    saveDraftState({
      title: "Untitled Decision",
      description: "",
      pastedText: text,
      aiAnswer,
      options,
    });
    setStep("format");
  };

  const handleUsePlainList = (plainOptions: Option[]) => {
    setOptions(plainOptions);
    saveDraftState({
      title: "Untitled Decision",
      description: "",
      pastedText,
      aiAnswer: "",
      options: plainOptions,
    });
    setStep("preview");
  };

  const handleValidAiOptions = (validated: Option[], rawAnswer: string) => {
    setOptions(validated);
    setAiAnswer(rawAnswer);
    saveDraftState({
      title: "Untitled Decision",
      description: "",
      pastedText,
      aiAnswer: rawAnswer,
      options: validated,
    });
    setStep("preview");
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
      navigate(`/p/${res.fileId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "40px 16px" }}>
        <h3>Creating project in Google Drive...</h3>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>
          Setting up your spreadsheet and tabs. Please authorize when prompted.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(220, 38, 38, 0.1)",
            color: "var(--color-danger, #ef4444)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {step === "paste" && (
        <PasteStep
          initialText={pastedText}
          onFormatWithAi={handleFormatWithAi}
          onUsePlainList={handleUsePlainList}
        />
      )}

      {step === "format" && (
        <FormatStep
          pastedText={pastedText}
          initialAiAnswer={aiAnswer}
          onValidOptions={handleValidAiOptions}
          onBack={() => setStep("paste")}
        />
      )}

      {step === "preview" && (
        <PreviewEditor
          initialOptions={options}
          onConfirm={handleConfirmProject}
          onBack={() => setStep(aiAnswer ? "format" : "paste")}
        />
      )}
    </div>
  );
}
