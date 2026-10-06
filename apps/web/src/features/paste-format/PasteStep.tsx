import { type Option, buildCorrection } from "@decisionator/core";
import { parsePlainList } from "@decisionator/source-paste";
import { AlertCircle, Braces, Check, Copy, ListPlus, Sparkles, X } from "lucide-react";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Textarea } from "../../components/ui/textarea.js";
import { type ProjectMeta, detectOptionsJson } from "./options-json.js";

export interface PasteStepProps {
  initialText?: string;
  onFormatWithAi: (text: string) => void;
  onUsePlainList: (options: Option[]) => void;
  /** Called with already-structured options when the pasted text is a Deci options JSON. */
  onUseJson: (options: Option[], rawText: string, project?: ProjectMeta) => void;
}

const MAX_BYTES = 200 * 1024; // 200 KB limit

export const PasteStep: React.FC<PasteStepProps> = ({
  initialText = "",
  onFormatWithAi,
  onUsePlainList,
  onUseJson,
}) => {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [copiedCorrection, setCopiedCorrection] = useState(false);
  // Set by onPaste so the change it triggers can skip straight to the preview.
  const justPasted = useRef(false);

  const detection = useMemo(() => detectOptionsJson(text), [text]);

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const lineCount = lines.length;

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const byteLength = new TextEncoder().encode(val).length;
    if (byteLength > MAX_BYTES) {
      setError(`Input exceeds 200 KB limit (${(byteLength / 1024).toFixed(1)} KB)`);
      return;
    }
    setError(null);
    setText(val);

    if (justPasted.current) {
      justPasted.current = false;
      // Agent output that already matches the options format needs no AI round-trip.
      const pasted = detectOptionsJson(val);
      if (pasted.kind === "valid") onUseJson(pasted.options, val, pasted.project);
    }
  };

  const handleUseJson = () => {
    if (detection.kind === "valid") onUseJson(detection.options, text, detection.project);
  };

  const handleCopyCorrection = async () => {
    if (detection.kind !== "invalid") return;
    try {
      await navigator.clipboard.writeText(buildCorrection(detection.errors));
      setCopiedCorrection(true);
      setTimeout(() => setCopiedCorrection(false), 2000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  const handleClear = () => {
    setText("");
    setError(null);
  };

  const handleAiFormat = () => {
    if (!text.trim()) {
      setError("Please paste some ideas before proceeding.");
      return;
    }
    onFormatWithAi(text);
  };

  const handlePlainList = () => {
    if (!text.trim()) {
      setError("Please paste some ideas before proceeding.");
      return;
    }
    const { candidates } = parsePlainList(text, { maxItems: 500 });
    if (candidates.length === 0) {
      setError("No valid items could be parsed from the plain list.");
      return;
    }
    const mappedOptions: Option[] = candidates.map((cand, idx) => ({
      id: `opt_${Date.now()}_${idx}`,
      order: idx + 1,
      status: "active" as const,
      title: cand.title,
      description: cand.description || "",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    }));
    onUsePlainList(mappedOptions);
  };

  return (
    <Card className="border-border bg-card shadow-xs">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Step 1: Paste Your Ideas</CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-1">
          Paste a brainstormed list, notes, or requirements. You can format them with any AI or
          parse directly as a plain list.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive font-medium"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {lineCount > 500 && detection.kind === "none" && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning font-medium"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Input contains {lineCount} lines. A preview cap of 500 items will be applied.
            </span>
          </div>
        )}

        {detection.kind === "valid" && (
          <output className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success/10 px-3.5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2 text-foreground">
              <Braces className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <span>
                <span className="font-semibold">Deci options JSON detected</span>
                {" — "}
                {detection.options.length} {detection.options.length === 1 ? "option" : "options"}
                {detection.project?.title && (
                  <>
                    {" for "}
                    <span className="font-medium">“{detection.project.title}”</span>
                  </>
                )}
                . No AI round-trip needed.
              </span>
            </span>
            <Button type="button" size="sm" onClick={handleUseJson} className="shrink-0">
              Use {detection.options.length} {detection.options.length === 1 ? "option" : "options"}
            </Button>
          </output>
        )}

        {detection.kind === "invalid" && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm"
          >
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              This looks like JSON, but it isn't a valid options list
            </div>
            <ul className="list-disc space-y-0.5 pl-6 text-foreground">
              {detection.errors.slice(0, 5).map((err) => (
                <li key={err} className="[overflow-wrap:anywhere]">
                  {err}
                </li>
              ))}
              {detection.errors.length > 5 && (
                <li className="text-muted-foreground">…and {detection.errors.length - 5} more</li>
              )}
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCorrection}
                leftIcon={
                  copiedCorrection ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )
                }
              >
                {copiedCorrection ? "Copied!" : "Copy correction for AI"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Send it to your agent, or use “Format with my AI” to start from this text.
              </span>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Textarea
            value={text}
            onChange={handleTextChange}
            onPaste={() => {
              justPasted.current = true;
            }}
            aria-label="Ideas or options JSON"
            placeholder={"Paste your ideas here...\n- Idea 1\n- Idea 2\n1. Option A"}
            rows={12}
            className="font-mono text-sm leading-relaxed resize-y bg-background"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground px-1">
            <span>
              {lineCount} {lineCount === 1 ? "line" : "lines"} detected
            </span>
            <span className="flex items-center gap-2">
              <span>{(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB / 200 KB</span>
              {text && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="h-7 px-2"
                  leftIcon={<X className="h-3.5 w-3.5" />}
                >
                  Clear
                </Button>
              )}
            </span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handlePlainList}
          disabled={!text.trim() || detection.kind === "valid"}
          title={
            detection.kind === "valid"
              ? "Pasted text is JSON; splitting it line by line would produce broken options."
              : undefined
          }
          leftIcon={<ListPlus className="h-4 w-4" />}
        >
          Use as plain list
        </Button>
        <Button
          type="button"
          variant={detection.kind === "valid" ? "outline" : "default"}
          onClick={handleAiFormat}
          disabled={!text.trim()}
          leftIcon={<Sparkles className="h-4 w-4" />}
        >
          Format with my AI
        </Button>
      </CardFooter>
    </Card>
  );
};

export default PasteStep;
