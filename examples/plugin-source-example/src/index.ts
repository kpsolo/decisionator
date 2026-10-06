import type {
  IdeaCandidate,
  IdeaSourcePlugin,
  IdeaSourceRequest,
  IdeaSourceResult,
} from "@decisionator/plugin-sdk";

export class SimpleListIdeaSource implements IdeaSourcePlugin {
  async fetch(req: IdeaSourceRequest): Promise<IdeaSourceResult> {
    const text = req.input?.clipboardText || "";
    const lines = text
      .split(/[\n,]/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const candidates: IdeaCandidate[] = lines.map((line, idx) => {
      // Split "Title — description" or "Title: description" if present
      let title = line;
      let description: string | undefined;

      const sepMatch = line.match(/^([^—:]+)[—:](.+)$/);
      if (sepMatch?.[1] && sepMatch[2]) {
        title = sepMatch[1].trim();
        description = sepMatch[2].trim();
      }

      // Safe bounds
      title = title.substring(0, 200);

      // Stable itemKey
      const itemKey = title.toLowerCase().replace(/[^a-z0-9]/g, "-") || `item-${idx}`;

      return {
        title,
        description,
        source: {
          sourceType: "clipboard",
          locator: "",
          itemKey,
        },
      };
    });

    return {
      candidates,
    };
  }
}
