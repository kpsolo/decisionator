import type { GoogleApiClient } from "./google-api.js";

export const TAB_HEADERS = {
  meta: ["key", "value"],
  options: ["id", "order", "status", "at", "by", "payload"],
  grades: ["id", "at", "by", "optionId", "payload"],
  comments: ["id", "at", "by", "optionId", "payload"],
  rankings: ["id", "at", "by", "payload"],
  outcomes: ["id", "at", "by", "payload"],
  contributions: ["id", "at", "by", "targetKind", "targetId", "payload"],
  properties: ["id", "at", "by", "optionId", "payload"],
} as const;

export type SheetTabName = keyof typeof TAB_HEADERS;

export interface SheetCreationMetadata {
  title: string;
  description?: string;
  ownerParticipantId: string;
  voting?: {
    state: "open" | "closed";
    round: number;
    topN: number;
    liveResults: boolean;
  };
  passwordProtected?: boolean;
  kdf?: string;
  kdfIterations?: number;
  salt?: string;
  verifier?: string;
  encryptedTitle?: string;
  encryptedDescription?: string;
}

/**
 * Creates the normative spreadsheet structure with standard tabs, headers,
 * drive appProperties, and initial meta rows according to contracts/sheet-store.md.
 */
export async function createProjectSpreadsheet(
  client: GoogleApiClient,
  meta: SheetCreationMetadata
): Promise<{ spreadsheetId: string }> {
  const tabNames: SheetTabName[] = [
    "meta",
    "options",
    "grades",
    "comments",
    "rankings",
    "outcomes",
    "contributions",
    "properties",
  ];

  // 1. Create spreadsheet with all required tabs
  const spreadsheet = await client.createSpreadsheet(meta.title, tabNames);
  const spreadsheetId = spreadsheet.spreadsheetId;

  // 2. Set Drive appProperties
  await client.updateFile(spreadsheetId, {
    appProperties: {
      decisionator: "project",
      formatVersion: "2",
    },
  });

  // 3. Prepare initial meta rows
  const metaRows: string[][] = [
    [...TAB_HEADERS.meta],
    ["formatVersion", "2"],
    ["createdAt", new Date().toISOString()],
    ["owner", meta.ownerParticipantId],
    ["protected", meta.passwordProtected ? "true" : "false"],
    [
      "voting",
      JSON.stringify(meta.voting ?? { state: "open", round: 1, topN: 3, liveResults: true }),
    ],
  ];

  if (meta.passwordProtected) {
    if (meta.kdf) metaRows.push(["kdf", meta.kdf]);
    if (meta.kdfIterations) metaRows.push(["kdfIterations", String(meta.kdfIterations)]);
    if (meta.salt) metaRows.push(["salt", meta.salt]);
    if (meta.verifier) metaRows.push(["verifier", meta.verifier]);
    metaRows.push(["title", meta.encryptedTitle ?? meta.title]);
    if (meta.encryptedDescription) {
      metaRows.push(["description", meta.encryptedDescription]);
    }
  } else {
    metaRows.push(["title", meta.title]);
    if (meta.description) {
      metaRows.push(["description", meta.description]);
    }
  }

  // 4. Batch populate headers across all tabs
  const initialData = [
    { range: "meta!A:B", values: metaRows },
    { range: "options!A:F", values: [[...TAB_HEADERS.options]] },
    { range: "grades!A:E", values: [[...TAB_HEADERS.grades]] },
    { range: "comments!A:E", values: [[...TAB_HEADERS.comments]] },
    { range: "rankings!A:D", values: [[...TAB_HEADERS.rankings]] },
    { range: "outcomes!A:D", values: [[...TAB_HEADERS.outcomes]] },
    { range: "contributions!A:F", values: [[...TAB_HEADERS.contributions]] },
    { range: "properties!A:E", values: [[...TAB_HEADERS.properties]] },
  ];

  await client.batchUpdateValues(spreadsheetId, initialData);

  return { spreadsheetId };
}
