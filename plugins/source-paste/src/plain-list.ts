import type { IdeaCandidate } from "@decisionator/plugin-sdk";
import { sha256 } from "@noble/hashes/sha2.js";

export interface PlainListParseOptions {
  maxItems?: number;
}

function hexDigest(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const hash = sha256(bytes);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function parsePlainList(
  text: string,
  opts: PlainListParseOptions = {}
): { candidates: IdeaCandidate[]; warnings: string[] } {
  const maxItems = opts.maxItems ?? 500;
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  const candidates: IdeaCandidate[] = [];

  for (const rawLine of lines) {
    if (candidates.length >= maxItems) {
      warnings.push(`Plain list reached item limit of ${maxItems} and was capped`);
      break;
    }

    // Strip leading list bullets, numbers, check boxes: -, *, •, 1., 1), [ ]
    const cleaned = rawLine.replace(/^\s*(?:[•\-*]|\d+[\.\)]|\[\s*\])\s*/, "").trim();

    // Drop empty lines
    if (!cleaned) continue;

    // Split on ' — ' or ': ' for title & description if present (R10)
    let title = cleaned;
    let description: string | undefined;

    const dashSplit = cleaned.split(/\s+[—–-]\s+/);
    if (dashSplit.length > 1) {
      title = dashSplit[0]?.trim() || "";
      description = dashSplit.slice(1).join(" — ").trim();
    } else {
      const colonSplit = cleaned.split(/:\s+/);
      if (colonSplit.length > 1 && colonSplit[0]?.length && colonSplit[0].length < 60) {
        title = colonSplit[0].trim();
        description = colonSplit.slice(1).join(": ").trim();
      }
    }

    // Truncate title to 200 chars
    if (title.length > 200) {
      title = title.substring(0, 200);
    }

    const itemKey = hexDigest(title.toLowerCase());

    candidates.push({
      title,
      description,
      source: {
        sourceType: "paste",
        locator: "",
        itemKey,
      },
    });
  }

  return { candidates, warnings };
}
