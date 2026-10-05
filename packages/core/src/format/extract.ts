export type ExtractResult =
  | { kind: "single"; json: string; warnings: string[] }
  | { kind: "choose"; candidates: string[] }
  | { kind: "none"; error: string };

const CITE_REGEX = /\[cite(?:_start|_end)?(?::\s*[^\]]*)?\]/g;

export function stripCitations(text: string): { cleaned: string; found: boolean } {
  let found = false;
  const cleaned = text.replace(CITE_REGEX, () => {
    found = true;
    return "";
  });
  return { cleaned, found };
}

export function extractOptionsJson(rawText: string): ExtractResult {
  const warnings: string[] = [];

  // Rule 5: Strip assistant citation tokens globally
  const { cleaned: sanitized, found: citationFound } = stripCitations(rawText);
  if (citationFound) {
    warnings.push("Assistant citation markers were stripped from response");
  }

  // Rule 1: Look for fenced ```json or ``` code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null;

  while (true) {
    match = codeBlockRegex.exec(sanitized);
    if (!match) break;
    const content = match[1]?.trim();
    if (content && (content.startsWith("{") || content.startsWith("["))) {
      codeBlocks.push(content);
    }
  }

  if (codeBlocks.length === 1) {
    const first = codeBlocks[0];
    if (first) {
      return { kind: "single", json: first, warnings };
    }
  }

  if (codeBlocks.length > 1) {
    return { kind: "choose", candidates: codeBlocks };
  }

  // Rule 2: Fallback to balanced { ... } or [ ... ]
  const firstBrace = sanitized.indexOf("{");
  const firstBracket = sanitized.indexOf("[");

  let startIdx = -1;
  let openChar = "{";
  let closeChar = "}";

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    openChar = "{";
    closeChar = "}";
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    openChar = "[";
    closeChar = "]";
  }

  if (startIdx !== -1) {
    let depth = 0;
    let endIdx = -1;
    let inString = false;
    let isEscaped = false;

    for (let i = startIdx; i < sanitized.length; i++) {
      const c = sanitized[i];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (c === "\\") {
          isEscaped = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }

      if (c === '"') {
        inString = true;
      } else if (c === openChar) {
        depth++;
      } else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx !== -1) {
      return {
        kind: "single",
        json: sanitized.substring(startIdx, endIdx),
        warnings,
      };
    }
  }

  return { kind: "none", error: "No JSON object or array found in text" };
}
