import type { Option } from "@decisionator/core";
import { parsePlainList } from "@decisionator/source-paste";
import type React from "react";
import { useState } from "react";

export interface PasteStepProps {
  initialText?: string;
  onFormatWithAi: (text: string) => void;
  onUsePlainList: (options: Option[]) => void;
}

const MAX_BYTES = 200 * 1024; // 200 KB limit

export const PasteStep: React.FC<PasteStepProps> = ({
  initialText = "",
  onFormatWithAi,
  onUsePlainList,
}) => {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

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
    const { candidates, warnings } = parsePlainList(text, { maxItems: 500 });
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
    <div className="paste-step card">
      <h3 style={{ marginBottom: 8 }}>Step 1: Paste Your Ideas</h3>
      <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
        Paste a brainstormed list, notes, or requirements. You can format them with any AI or parse
        directly as a plain list.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: "rgba(220, 38, 38, 0.1)",
            color: "var(--color-danger, #ef4444)",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {lineCount > 500 && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: "rgba(234, 179, 8, 0.1)",
            color: "#ca8a04",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          Input contains {lineCount} lines. A preview cap of 500 items will be applied.
        </div>
      )}

      <textarea
        value={text}
        onChange={handleTextChange}
        placeholder="Paste your ideas here...&#10;- Idea 1&#10;- Idea 2&#10;1. Option A"
        rows={12}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "monospace",
          fontSize: 14,
          boxSizing: "border-box",
          marginBottom: 16,
        }}
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handlePlainList}
          className="btn btn-outline"
          disabled={!text.trim()}
        >
          Use as plain list
        </button>
        <button
          type="button"
          onClick={handleAiFormat}
          className="btn btn-primary"
          disabled={!text.trim()}
        >
          Format with my AI
        </button>
      </div>
    </div>
  );
};
