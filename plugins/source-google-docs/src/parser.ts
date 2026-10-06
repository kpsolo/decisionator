import type { IdeaCandidate } from "@decisionator/plugin-sdk";
import { sha256 } from "@noble/hashes/sha2.js";

export interface GoogleDocStructuralElement {
  paragraph?: {
    elements?: Array<{
      textRun?: {
        content?: string;
      };
    }>;
    paragraphStyle?: {
      namedStyleType?: string;
    };
    bullet?: {
      listId?: string;
    };
  };
}

export interface GoogleDocResponse {
  documentId: string;
  title?: string;
  body?: {
    content?: GoogleDocStructuralElement[];
  };
}

export function computeDocItemKey(documentId: string, text: string): string {
  const normalized = text.trim().toLowerCase();
  const encoder = new TextEncoder();
  const bytes = encoder.encode(`${documentId}:${normalized}`);
  const hash = sha256(bytes);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extractParagraphText(element: GoogleDocStructuralElement): string {
  if (!element.paragraph?.elements) return "";
  return element.paragraph.elements
    .map((el) => el.textRun?.content ?? "")
    .join("")
    .trim();
}

/**
 * Extracts candidate ideas from a Google Docs document.
 * Tries list items first; if none, extracts heading-delimited sections; otherwise falls back to lines.
 */
export function extractIdeasFromDoc(doc: GoogleDocResponse): IdeaCandidate[] {
  const documentId = doc.documentId;
  const docTitle = doc.title || "Google Document";
  const elements = doc.body?.content ?? [];
  const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

  // 1. Check for list items (bullet points)
  const listParagraphs: string[] = [];
  for (const el of elements) {
    if (el.paragraph?.bullet) {
      const text = extractParagraphText(el);
      if (text.length > 0) {
        listParagraphs.push(text);
      }
    }
  }

  if (listParagraphs.length > 0) {
    return listParagraphs.map((text) => {
      let title = text;
      let description: string | undefined;

      // Check for delimiter splitting "Title: Description" or "Title — Description"
      const dashMatch = text.match(/^(.+?)\s+[—-]\s+(.+)$/);
      const colonMatch = text.match(/^([^:\n]+):\s+(.+)$/);
      if (dashMatch?.[1] && dashMatch[2]) {
        title = dashMatch[1].trim();
        description = dashMatch[2].trim();
      } else if (colonMatch?.[1] && colonMatch[2]) {
        title = colonMatch[1].trim();
        description = colonMatch[2].trim();
      }

      // Title must be between 1 and 200 characters
      const cleanTitle = title.slice(0, 200).trim();

      return {
        title: cleanTitle,
        description,
        source: {
          sourceType: "google-docs",
          locator: documentId,
          itemKey: computeDocItemKey(documentId, cleanTitle),
          title: docTitle,
          url: docUrl,
        },
      };
    });
  }

  // 2. Check for heading-delimited sections
  const sections: Array<{ heading: string; body: string[] }> = [];
  let currentSection: { heading: string; body: string[] } | null = null;

  for (const el of elements) {
    const style = el.paragraph?.paragraphStyle?.namedStyleType;
    const text = extractParagraphText(el);
    if (!text) continue;

    if (style?.startsWith("HEADING_")) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { heading: text, body: [] };
    } else if (currentSection) {
      currentSection.body.push(text);
    }
  }
  if (currentSection) {
    sections.push(currentSection);
  }

  if (sections.length > 0) {
    return sections.map((sec) => {
      const cleanTitle = sec.heading.slice(0, 200).trim();
      const description = sec.body.length > 0 ? sec.body.join("\n\n") : undefined;

      return {
        title: cleanTitle,
        description,
        source: {
          sourceType: "google-docs",
          locator: documentId,
          itemKey: computeDocItemKey(documentId, cleanTitle),
          title: docTitle,
          url: docUrl,
        },
      };
    });
  }

  // 3. Fallback: non-empty paragraphs
  const candidates: IdeaCandidate[] = [];
  for (const el of elements) {
    const text = extractParagraphText(el);
    if (text) {
      const cleanTitle = text.slice(0, 200).trim();
      candidates.push({
        title: cleanTitle,
        source: {
          sourceType: "google-docs",
          locator: documentId,
          itemKey: computeDocItemKey(documentId, cleanTitle),
          title: docTitle,
          url: docUrl,
        },
      });
    }
  }

  return candidates;
}
