# Contract: Idea Source — v1.0.0

> **Scope:** the paste/format source ships in the MVP. The Google Docs source ships in US6.

Platform key: `platform.ideaSource`. Manifest declaration: `provides.ideaSource`.
Built-ins: paste + format (`input: "clipboard"`, MVP; parsing per [format-instruction.md](./format-instruction.md)), Google Docs (`input: "oauth"`, US6). Obsidian or other
sources are external plugins that use this same contract (FR-055).

## Interface

```ts
interface IdeaSourceRequest {
  mode: "import" | "refresh";
  input?: { clipboardText?: string; form?: unknown };    // host-collected, per manifest.input
  previous?: { locator: string; itemKeys: string[] }[];  // on refresh: what was imported before
}

interface IdeaCandidate {
  title: string;            // 1–200 chars after trim
  description?: string;     // markdown
  source: {
    sourceType: string;     // = manifest sourceType
    locator: string;        // e.g. Google document id; "" for clipboard
    itemKey: string;        // stable key for de-duplication (FR-054)
    title?: string;
    url?: string;
  };
}

interface IdeaSourceResult {
  candidates: IdeaCandidate[];
  unavailable?: { locator: string; reason: string }[];  // e.g. doc deleted or access revoked
  warnings?: string[];
}

interface IdeaSourcePlugin {
  fetch(req: IdeaSourceRequest): Promise<IdeaSourceResult>;
}
```

RPC method: `ideaSource.fetch`.

## Host responsibilities

1. Collect input according to `manifest.provides.ideaSource.input`:
   - `clipboard`: read the clipboard text on the user's click (requires `clipboard:read`) and
     pass it in.
   - `oauth`: the plugin calls `ctx.oauth.getToken(...)` itself. The host runs the consent flow.
   - `form`: render the form from the plugin's `settingsSchema`.
2. Show a **preview** of the candidates, capped at 500, the format's maximum; the user can lower the cap. Nothing is
   written before the user confirms (US6 #2).
3. On confirm, upsert ideas keyed by `(pluginId, locator, itemKey)`. Existing keys are never
   duplicated or overwritten. Locators reported as `unavailable` get their `SourceRef.status`
   set to `unavailable` (US6 #2, edge cases).

## Built-in behaviour summary

| Plugin | Parsing | itemKey |
|--------|---------|---------|
| Clipboard ([research R10](../research.md)) | lines / list items; `Title — desc` / `Title: desc` split | `sha256(normalizedTitle)` |
| Google Docs ([research R9](../research.md)) | list items, else heading-delimited sections | `sha256(documentId + normalizedText)` |

## Contract test kit

`runIdeaSourceContractTests(plugin, fixtures)` checks:
- titles are within bounds;
- itemKeys are stable across runs and unique within a result;
- refresh with an unchanged source returns the same keys;
- unavailable sources are reported, not thrown.
