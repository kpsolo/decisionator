import {
  type NormalizedOptionCandidate,
  type Option,
  extractOptionsJson,
  validateOptionsPayload,
} from "@decisionator/core";

export interface ProjectMeta {
  title: string;
  description?: string;
}

export type OptionsJsonDetection =
  /** Text doesn't look like JSON (an idea list, notes…). */
  | { kind: "none" }
  | {
      kind: "valid";
      options: Option[];
      project?: ProjectMeta;
      warnings: string[];
    }
  /** Text is meant to be options JSON but doesn't parse or validate. */
  | { kind: "invalid"; errors: string[]; warnings: string[] };

// A JSON object/array opening at the start (`{"`, `[{`, `["`), or a fenced ```json / ``` block
// holding one: what agents and chat assistants paste. Idea lists such as "[Q4] Hire" or
// "- Idea [draft]" must not be mistaken for JSON.
const LOOKS_LIKE_JSON = /^\s*(?:\{\s*["}]|\[\s*[{"\]])|```(?:json)?\s*[{[]/i;

/** Normalizes validated candidates into wizard options (fresh ids, contiguous order). */
export function toOptions(candidates: NormalizedOptionCandidate[]): Option[] {
  const stamp = Date.now();
  return candidates.map((opt, idx) => ({
    id: opt.id || `opt_${stamp}_${idx}`,
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
}

/**
 * Detects a pasted `decisionator.options/v1` payload (bare or fenced, with or without
 * surrounding chat text). Text that doesn't look like JSON is left for the idea-list paths.
 */
export function detectOptionsJson(text: string): OptionsJsonDetection {
  if (!LOOKS_LIKE_JSON.test(text)) return { kind: "none" };
  return parseOptionsJson(text);
}

/**
 * Extracts and validates options JSON from text that is expected to contain it (an agent's
 * reply), trying each fenced block until one validates.
 */
export function parseOptionsJson(text: string): Exclude<OptionsJsonDetection, { kind: "none" }> {
  const extraction = extractOptionsJson(text);
  if (extraction.kind === "none") {
    return { kind: "invalid", errors: [extraction.error], warnings: [] };
  }

  const blocks = extraction.kind === "choose" ? extraction.candidates : [extraction.json];
  const initialWarnings = extraction.kind === "single" ? extraction.warnings : [];

  let firstFailure: Extract<OptionsJsonDetection, { kind: "invalid" }> | null = null;
  for (const block of blocks) {
    const result = validateOptionsPayload(block, initialWarnings);
    if (result.ok) {
      return {
        kind: "valid",
        options: toOptions(result.options),
        project: result.project,
        warnings: result.warnings,
      };
    }
    firstFailure ??= { kind: "invalid", errors: result.errors, warnings: result.warnings };
  }
  return (
    firstFailure ?? {
      kind: "invalid",
      errors: ["No JSON object or array found in text"],
      warnings: [],
    }
  );
}
