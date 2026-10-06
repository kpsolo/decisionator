import type { GoogleDocResponse } from "./parser.js";

export interface DocsFetchOptions {
  accessToken?: string;
  fetchFn?: typeof fetch;
}

export class GoogleDocsClient {
  constructor(private options: DocsFetchOptions = {}) {}

  async getDocument(
    documentId: string
  ): Promise<{ doc?: GoogleDocResponse; unavailable?: string }> {
    const fetchFn = this.options.fetchFn ?? fetch;
    const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`;

    const headers: Record<string, string> = {};
    if (this.options.accessToken) {
      headers.Authorization = `Bearer ${this.options.accessToken}`;
    }

    try {
      const response = await fetchFn(url, { headers });
      if (!response.ok) {
        if (response.status === 404) {
          return { unavailable: "Document not found" };
        }
        if (response.status === 403) {
          return { unavailable: "Insufficient permissions or document access revoked" };
        }
        return { unavailable: `HTTP ${response.status}: ${response.statusText}` };
      }

      const doc = (await response.json()) as GoogleDocResponse;
      return { doc };
    } catch (err) {
      return { unavailable: err instanceof Error ? err.message : String(err) };
    }
  }
}
