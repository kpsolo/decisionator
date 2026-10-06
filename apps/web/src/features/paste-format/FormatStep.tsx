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
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Sparkles } from "lucide-react";
import type React from "react";
import { useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import { ConnectAgent } from "../agents/ConnectAgent.js";
import { type ProjectMeta, toOptions } from "./options-json.js";

export interface FormatStepProps {
  pastedText: string;
  initialAiAnswer?: string;
  onValidOptions: (options: Option[], rawAnswer: string, project?: ProjectMeta) => void;
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
  const localeInputId = useId();
  const answerInputId = useId();

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
      onValidOptions(toOptions(validationReport.options), aiAnswer, validationReport.project);
    }
  };

  return (
    <Card className="border-border bg-card shadow-xs">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xl font-bold">Step 2: AI Round-Trip & Validation</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back to Paste
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <ConnectAgent
          pastedText={pastedText}
          localeHint={localeHint}
          onFormatted={onValidOptions}
        />

        {/* Manual round-trip */}
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium text-sm text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Or manually: 1. Copy the formatting instructions below and paste them into ChatGPT,
              Claude, Gemini, or any LLM.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor={localeInputId}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              Language hint:
            </label>
            <Input
              id={localeInputId}
              type="text"
              value={localeHint}
              onChange={(e) => setLocaleHint(e.target.value)}
              className="h-8 w-16 text-center font-mono text-xs"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleCopyInstruction}
              leftIcon={<Copy className="h-3.5 w-3.5" />}
            >
              {copied ? "Copied!" : "Copy instructions for AI"}
            </Button>
          </div>
        </div>

        {/* Paste AI response */}
        <div className="space-y-2">
          <label htmlFor={answerInputId} className="text-sm font-medium text-foreground">
            2. Paste the AI's response here:
          </label>
          <Textarea
            id={answerInputId}
            value={aiAnswer}
            onChange={(e) => setAiAnswer(e.target.value)}
            placeholder="Paste AI response here..."
            rows={10}
            className="font-mono text-xs leading-relaxed bg-background"
          />
        </div>

        {/* Multiple blocks choice */}
        {extraction?.kind === "choose" && (
          <section
            aria-label="Choose JSON block"
            className="rounded-lg border border-border bg-card p-4 space-y-2"
          >
            <h4 className="font-semibold text-sm">Multiple JSON blocks found</h4>
            <p className="text-xs text-muted-foreground">
              The AI provided multiple code blocks. Please select which block to import:
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {extraction.candidates.map((candStr, idx) => (
                <Button
                  key={candStr}
                  type="button"
                  size="sm"
                  variant={chosenBlockIndex === idx ? "default" : "outline"}
                  aria-pressed={chosenBlockIndex === idx}
                  onClick={() => setChosenBlockIndex(idx)}
                  className="font-mono text-xs"
                >
                  Block {idx + 1} ({candStr.slice(0, 30)}...)
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* Warnings & Errors */}
        {validationReport && (
          <div className="space-y-3">
            {validationReport.warnings.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-xs text-warning space-y-1"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <strong>Warnings:</strong>
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {validationReport.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {!validationReport.ok && validationReport.errors.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    <strong>Validation Errors:</strong>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyCorrection}
                    className="h-7 text-xs"
                  >
                    {copiedCorrection ? "Copied!" : "Copy correction for AI"}
                  </Button>
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {validationReport.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {validationReport.ok && (
              <output className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-xs text-success font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Successfully parsed and validated {validationReport.options.length} options!
                </span>
              </output>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-end border-t border-border pt-4">
        <Button
          type="button"
          variant="default"
          onClick={handleProceed}
          disabled={!validationReport?.ok}
        >
          Proceed to Preview &rarr;
        </Button>
      </CardFooter>
    </Card>
  );
};
