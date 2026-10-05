import type {
  IdeaSourcePlugin,
  IdeaSourceRequest,
  IdeaSourceResult,
} from "@decisionator/plugin-sdk";
import { GoogleDocsClient } from "./google-docs-api.js";
import { type GoogleDocResponse, extractIdeasFromDoc } from "./parser.js";

export * from "./parser.js";
export * from "./google-docs-api.js";

export interface GoogleDocsIdeaSourceOptions {
  client?: GoogleDocsClient;
  defaultDocumentId?: string;
  mockDocuments?: Record<string, GoogleDocResponse>;
}

export class GoogleDocsIdeaSourcePlugin implements IdeaSourcePlugin {
  private client: GoogleDocsClient;
  private defaultDocId?: string;
  private mockDocuments?: Record<string, GoogleDocResponse>;

  constructor(options: GoogleDocsIdeaSourceOptions = {}) {
    this.client = options.client ?? new GoogleDocsClient();
    this.defaultDocId = options.defaultDocumentId;
    this.mockDocuments = options.mockDocuments;
  }

  async fetch(req: IdeaSourceRequest): Promise<IdeaSourceResult> {
    // Determine target document ID from form input, previous refresh locator, or default
    const form = req.input?.form as { documentId?: string } | undefined;
    const documentId = form?.documentId || req.previous?.[0]?.locator || this.defaultDocId;

    if (!documentId) {
      return {
        candidates: [],
        warnings: ["No Google Document ID specified."],
      };
    }

    // Check mock documents (for testing or offline simulation)
    if (this.mockDocuments?.[documentId]) {
      const candidates = extractIdeasFromDoc(this.mockDocuments[documentId]);
      return { candidates };
    }

    const { doc, unavailable } = await this.client.getDocument(documentId);

    if (unavailable || !doc) {
      return {
        candidates: [],
        unavailable: [
          {
            locator: documentId,
            reason: unavailable || "Unable to access document",
          },
        ],
      };
    }

    const candidates = extractIdeasFromDoc(doc);
    return { candidates };
  }
}

export const googleDocsSource = new GoogleDocsIdeaSourcePlugin();
