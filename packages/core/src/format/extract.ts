export type ExtractResult =
  | { kind: "single"; json: string; warnings: string[] }
  | { kind: "choose"; candidates: string[] }
  | { kind: "none"; error: string };

const CITE_REGEX = /\[cite(?:_start|_end)?(?::\s*[^\]]*)?\]/g;

/**
 * A fenced code block: the opening ``` (optionally tagged `json`) and the closing ``` must each
 * stand on their own line. JSON strings cannot hold raw line breaks, so a ``` inside a JSON string
 * never ends the block.
 */
const FENCED_BLOCK_REGEX = /^[ \t]*```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gim;

/** How many opening brackets the balanced fallback tries before giving up. */
const MAX_BALANCED_CANDIDATES = 200;

export function stripCitations(text: string): { cleaned: string; found: boolean } {
  let found = false;
  const cleaned = text.replace(CITE_REGEX, () => {
    found = true;
    return "";
  });
  return { cleaned, found };
}

/**
 * Returns the end index (exclusive) of the balanced `{…}` / `[…]` that opens at `startIdx`, or -1
 * when it never closes or a closer does not match its opener. Brackets inside JSON strings are
 * ignored.
 */
function balancedEnd(text: string, startIdx: number): number {
  const stack: string[] = [];
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];

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
    } else if (c === "{") {
      stack.push("}");
    } else if (c === "[") {
      stack.push("]");
    } else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** An options payload: an object, or a non-empty array of objects (bare options list). */
function looksLikeOptionsPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((v) => typeof v === "object" && v !== null);
  }
  return typeof value === "object" && value !== null;
}

/**
 * Rule 2 fallback: tries every balanced `{…}` / `[…]` in order. Picks the first that parses to an
 * options payload, else the first that parses at all, else the first balanced one (so validation
 * can report its parse error).
 */
function findBalancedJson(text: string): string | undefined {
  let firstBalanced: string | undefined;
  let firstParsed: string | undefined;
  let tried = 0;

  for (let i = 0; i < text.length && tried < MAX_BALANCED_CANDIDATES; i++) {
    const c = text[i];
    if (c !== "{" && c !== "[") continue;
    tried++;
    const end = balancedEnd(text, i);
    if (end === -1) continue;

    const candidate = text.substring(i, end);
    firstBalanced ??= candidate;
    const parsed = tryParse(candidate);
    if (!parsed.ok) continue;
    if (looksLikeOptionsPayload(parsed.value)) return candidate;
    firstParsed ??= candidate;
  }
  return firstParsed ?? firstBalanced;
}

export function extractOptionsJson(rawText: string): ExtractResult {
  const warnings: string[] = [];

  // Rule 5: Strip assistant citation tokens globally
  const { cleaned: sanitized, found: citationFound } = stripCitations(rawText);
  if (citationFound) {
    warnings.push("Assistant citation markers were stripped from response");
  }

  // Rule 1: Look for fenced ```json or ``` code blocks
  const codeBlocks: string[] = [];
  for (const match of sanitized.matchAll(FENCED_BLOCK_REGEX)) {
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

  // Rule 2: Fallback to the first balanced { ... } or [ ... ] that holds the options
  const json = findBalancedJson(sanitized);
  if (json !== undefined) {
    return { kind: "single", json, warnings };
  }

  return { kind: "none", error: "No JSON object or array found in text" };
}
