export interface IdeaSourceRequest {
  mode: "import" | "refresh";
  input?: { clipboardText?: string; form?: unknown };
  previous?: { locator: string; itemKeys: string[] }[];
}

export interface IdeaCandidate {
  title: string;
  description?: string;
  source: {
    sourceType: string;
    locator: string;
    itemKey: string;
    title?: string;
    url?: string;
  };
}

export interface IdeaSourceResult {
  candidates: IdeaCandidate[];
  unavailable?: { locator: string; reason: string }[];
  warnings?: string[];
}

export interface IdeaSourcePlugin {
  fetch(req: IdeaSourceRequest): Promise<IdeaSourceResult>;
}
