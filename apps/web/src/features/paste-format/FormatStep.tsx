import {
  type ExtractResult,
  type Option,
  type ValidateResult,
  buildCorrection,
  buildInstruction,
  detectLanguage,
  extractOptionsJson,
  validateOptionsPayload,
} from "@decisionator/core";
import type React from "react";
import { useMemo, useState } from "react";

export interface FormatStepProps {
  pastedText: string;
  initialAiAnswer?: string;
  onValidOptions: (options: Option[], rawAnswer: string) => void;
  onBack: () => void;
}

export const FormatStep: React.FC<FormatStepProps> = ({
  pastedText,
  initialAiAnswer = "",
  onValidOptions,
  onBack,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedCorrection, setCopiedCorrection] = useState(false);
  const [aiAnswer, setAiAnswer] = useState(initialAiAnswer);
  const [chosenBlockIndex, setChosenBlockIndex] = useState<number>(0);

  const detectedLang = useMemo(() => detectLanguage(pastedText), [pastedText]);
  const [localeHint, setLocaleHint] = useState(detectedLang);

  const instructionPrompt = useMemo(
    () => buildInstruction(pastedText, localeHint),
    [pastedText, localeHint]
  );

  const extraction: ExtractResult | null = useMemo(() => {
    if (!aiAnswer.trim()) return null;
    return extractOptionsJson(aiAnswer);
  }, [aiAnswer]);

  const selectedJson = useMemo(() => {
    if (!extraction) return null;
    if (extraction.kind === "choose") {
      return extraction.candidates[chosenBlockIndex] ?? null;
    }
    if (extraction.kind === "single") {
      return extraction.json;
    }
    return null;
  }, [extraction, chosenBlockIndex]);

  const validationReport: ValidateResult | null = useMemo(() => {
    if (!selectedJson) return null;
    return validateOptionsPayload(selectedJson);
  }, [selectedJson]);

  const handleCopyInstruction = async () => {
    await navigator.clipboard.writeText(instructionPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCorrection = async () => {
    if (!validationReport || validationReport.ok) return;
    const correctionText = buildCorrection(validationReport.errors);
    await navigator.clipboard.writeText(correctionText);
    setCopiedCorrection(true);
    setTimeout(() => setCopiedCorrection(false), 2000);
  };

  const handleProceed = () => {
    if (validationReport?.ok && validationReport.options) {
      const normalizedOptions: Option[] = validationReport.options.map((opt, idx) => ({
        id: opt.id || `opt_${Date.now()}_${idx}`,
        order: idx + 1,
        status: "active" as const,
        title: opt.title,
        description: opt.description,
        category: opt.category,
        tags: opt.tags,
        pros: opt.pros,
        cons: opt.cons,
        effort: opt.effort,
        links: opt.links,
      }));
      onValidOptions(normalizedOptions, aiAnswer);
    }
  };

  return (
    <div className="format-step card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0 }}>Step 2: AI Round-Trip & Validation</h3>
        <button
          type="button"
          onClick={onBack}
          className="btn btn-outline"
          style={{ padding: "4px 8px" }}
        >
          &larr; Back to Paste
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          1. Copy the formatting instructions below and paste them into ChatGPT, Claude, Gemini, or
          any LLM.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Language hint:{" "}
            <input
              type="text"
              value={localeHint}
              onChange={(e) => setLocaleHint(e.target.value)}
              style={{
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                width: 60,
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleCopyInstruction}
            className="btn btn-primary"
            style={{ fontSize: 13 }}
          >
            {copied ? "Copied!" : "Copy instructions for AI"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 8 }}>
          2. Paste the AI's response here:
        </p>
        <textarea
          value={aiAnswer}
          onChange={(e) => setAiAnswer(e.target.value)}
          placeholder="Paste AI response here..."
          rows={10}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "monospace",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Multiple blocks choice */}
      {extraction?.kind === "choose" && (
        <section
          aria-label="Choose JSON block"
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            marginBottom: 16,
            background: "var(--card-bg)",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0" }}>Multiple JSON blocks found</h4>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px 0" }}>
            The AI provided multiple code blocks. Please select which block to import:
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {extraction.candidates.map((candStr, idx) => (
              <button
                key={candStr}
                type="button"
                onClick={() => setChosenBlockIndex(idx)}
                className={`btn ${chosenBlockIndex === idx ? "btn-primary" : "btn-outline"}`}
                style={{ fontSize: 12 }}
              >
                Block {idx + 1} ({candStr.slice(0, 30)}...)
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Warnings & Errors */}
      {validationReport && (
        <div style={{ marginBottom: 16 }}>
          {validationReport.warnings.length > 0 && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(234, 179, 8, 0.1)",
                color: "#ca8a04",
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              <strong>Warnings:</strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {validationReport.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {!validationReport.ok && validationReport.errors.length > 0 && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(220, 38, 38, 0.1)",
                color: "var(--color-danger, #ef4444)",
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <strong>Validation Errors:</strong>
                <button
                  type="button"
                  onClick={handleCopyCorrection}
                  className="btn btn-outline"
                  style={{ fontSize: 12, padding: "2px 8px" }}
                >
                  {copiedCorrection ? "Copied!" : "Copy correction for AI"}
                </button>
              </div>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {validationReport.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {validationReport.ok && (
            <output
              style={{
                display: "block",
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(34, 197, 94, 0.1)",
                color: "#16a34a",
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              Successfully parsed and validated {validationReport.options.length} options!
            </output>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleProceed}
          className="btn btn-primary"
          disabled={!validationReport?.ok}
        >
          Proceed to Preview &rarr;
        </button>
      </div>
    </div>
  );
};
