export type ExtractResult =
  | { kind: "single"; json: string; warnings: string[] }
  | { kind: "choose"; candidates: string[] }
  | { kind: "none"; error: string };

/**
 * Longest text (UTF-16 code units, about 1 MB) that extraction accepts. Larger pastes are refused
 * with a clear error instead of being scanned: no options list is anywhere near this size.
 */
export const MAX_EXTRACT_INPUT_LENGTH = 1_000_000;

/** An opening fence line: ``` optionally tagged `json` (any case), alone on its line. */
const FENCE_OPEN_LINE = /^[ \t]*```[ \t]*(?:json)?[ \t]*$/i;
/** A closing fence line: ``` alone on its line. */
const FENCE_CLOSE_LINE = /^[ \t]*```[ \t]*$/;

/** How many opening brackets the balanced fallback tries before giving up. */
const MAX_BALANCED_CANDIDATES = 200;

/**
 * Removes assistant citation tokens: `[cite]`, `[cite_start]`, `[cite_end]` and `[cite: …]` (the
 * last one up to the next `]`). A single forward scan, so many unclosed `[cite:` cannot make it
 * quadratic.
 */
export function stripCitations(text: string): { cleaned: string; found: boolean } {
  let found = false;
  let out = "";
  let pos = 0;
  let nextClose = -1;
  for (;;) {
    const start = text.indexOf("[cite", pos);
    if (start === -1) break;
    let i = start + 5;
    if (text.startsWith("_start", i)) i += 6;
    else if (text.startsWith("_end", i)) i += 4;
    let end = -1;
    if (text[i] === "]") {
      end = i + 1;
    } else if (text[i] === ":") {
      if (nextClose < i) nextClose = text.indexOf("]", i);
      if (nextClose === -1) break; // no "]" anywhere after: no further token can close
      end = nextClose + 1;
    }
    if (end === -1) {
      out += text.slice(pos, start + 1);
      pos = start + 1;
      continue;
    }
    found = true;
    out += text.slice(pos, start);
    pos = end;
  }
  return { cleaned: found ? out + text.slice(pos) : text, found };
}

/**
 * Contents of the fenced code blocks: the opening ``` (optionally tagged `json`) and the closing
 * ``` must each stand on their own line. JSON strings cannot hold raw line breaks, so a ``` inside
 * a JSON string never ends the block. A line scanner, linear in the text length: an opening fence
 * that never closes ends the scan, because no later fence could close either.
 */
function fencedBlocks(text: string): string[] {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!FENCE_OPEN_LINE.test(lines[i] ?? "")) {
      i++;
      continue;
    }
    let close = i + 1;
    while (close < lines.length && !FENCE_CLOSE_LINE.test(lines[close] ?? "")) close++;
    if (close >= lines.length) break;
    blocks.push(lines.slice(i + 1, close).join("\n"));
    i = close + 1;
  }
  return blocks;
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

  if (rawText.length > MAX_EXTRACT_INPUT_LENGTH) {
    return {
      kind: "none",
      error: `The pasted text is too long (${rawText.length} characters). The limit is ${MAX_EXTRACT_INPUT_LENGTH} characters; paste only the reply that holds the options.`,
    };
  }

  // Rule 5: Strip assistant citation tokens globally
  const { cleaned: sanitized, found: citationFound } = stripCitations(rawText);
  if (citationFound) {
    warnings.push("Assistant citation markers were stripped from response");
  }

  // Rule 1: Look for fenced ```json or ``` code blocks
  const codeBlocks: string[] = [];
  for (const block of fencedBlocks(sanitized)) {
    const content = block.trim();
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
