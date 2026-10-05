import { extractOptionsJson, validateOptionsPayload } from "@decisionator/core";
import type {
  IdeaCandidate,
  IdeaSourcePlugin,
  IdeaSourceRequest,
  IdeaSourceResult,
} from "@decisionator/plugin-sdk";
import { parsePlainList } from "./plain-list.js";

export const SOURCE_PASTE_ID = "org.decisionator.source.paste";

export class PasteIdeaSourcePlugin implements IdeaSourcePlugin {
  async fetch(req: IdeaSourceRequest): Promise<IdeaSourceResult> {
    const text = req.input?.clipboardText || "";
    if (!text.trim()) {
      return { candidates: [], warnings: ["Clipboard input was empty"] };
    }

    const warnings: string[] = [];

    // Attempt AI JSON extraction first
    const extractRes = extractOptionsJson(text);
    if (extractRes.kind === "single") {
      const validateRes = validateOptionsPayload(extractRes.json, extractRes.warnings);
      if (validateRes.ok) {
        const candidates: IdeaCandidate[] = validateRes.options.map((opt) => ({
          title: opt.title,
          description: opt.description,
          source: {
            sourceType: "paste",
            locator: "",
            itemKey: opt.id || opt.title.toLowerCase().trim(),
          },
        }));
        return {
          candidates,
          warnings: [...warnings, ...validateRes.warnings],
        };
      }
    }

    // Fall back to plain-list parser
    const listRes = parsePlainList(text);
    return {
      candidates: listRes.candidates,
      warnings: [...warnings, ...listRes.warnings],
    };
  }
}

export * from "./plain-list.js";
