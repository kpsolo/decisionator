import { runIdeaSourceContractTests } from "@decisionator/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  type GoogleDocResponse,
  GoogleDocsIdeaSourcePlugin,
  computeDocItemKey,
  extractIdeasFromDoc,
} from "../src/index.js";

const sampleBulletDoc: GoogleDocResponse = {
  documentId: "doc_bullet_123",
  title: "Team Retrospective Ideas",
  body: {
    content: [
      {
        paragraph: {
          elements: [{ textRun: { content: "Unrelated intro paragraph\n" } }],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "Asynchronous Standups: Use Slack bots\n" } }],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          bullet: { listId: "list_1" },
        },
      },
      {
        paragraph: {
          elements: [
            { textRun: { content: "Weekly Demo Hour — Share progress with stakeholders\n" } },
          ],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          bullet: { listId: "list_1" },
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "Document Everything\n" } }],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          bullet: { listId: "list_1" },
        },
      },
    ],
  },
};

const sampleHeadingDoc: GoogleDocResponse = {
  documentId: "doc_heading_456",
  title: "Feature Roadmap 2027",
  body: {
    content: [
      {
        paragraph: {
          elements: [{ textRun: { content: "Decentralized Sync Engine\n" } }],
          paragraphStyle: { namedStyleType: "HEADING_1" },
        },
      },
      {
        paragraph: {
          elements: [
            { textRun: { content: "Enables multi-device peer-to-peer sync without servers.\n" } },
          ],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "Zero-Knowledge Relays\n" } }],
          paragraphStyle: { namedStyleType: "HEADING_1" },
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "Blind message routing using public keys.\n" } }],
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        },
      },
    ],
  },
};

describe("GoogleDocsIdeaSourcePlugin Contract Tests (FR-054, T110)", () => {
  const plugin = new GoogleDocsIdeaSourcePlugin({
    mockDocuments: {
      doc_bullet_123: sampleBulletDoc,
      doc_heading_456: sampleHeadingDoc,
    },
    defaultDocumentId: "doc_bullet_123",
  });

  // Run the standard IdeaSource contract test suite from plugin-sdk
  runIdeaSourceContractTests(plugin, {
    validRequest: {
      mode: "import",
      input: { form: { documentId: "doc_bullet_123" } },
    },
    unavailableRequest: {
      mode: "import",
      input: { form: { documentId: "non_existent_doc" } },
    },
  });

  it("extracts list items with title and description splitting", async () => {
    const candidates = extractIdeasFromDoc(sampleBulletDoc);
    expect(candidates.length).toBe(3);

    expect(candidates[0]?.title).toBe("Asynchronous Standups");
    expect(candidates[0]?.description).toBe("Use Slack bots");
    expect(candidates[0]?.source.locator).toBe("doc_bullet_123");
    expect(candidates[0]?.source.url).toBe(
      "https://docs.google.com/document/d/doc_bullet_123/edit"
    );

    expect(candidates[1]?.title).toBe("Weekly Demo Hour");
    expect(candidates[1]?.description).toBe("Share progress with stakeholders");

    expect(candidates[2]?.title).toBe("Document Everything");
    expect(candidates[2]?.description).toBeUndefined();
  });

  it("extracts heading-delimited sections when list items are absent", async () => {
    const candidates = extractIdeasFromDoc(sampleHeadingDoc);
    expect(candidates.length).toBe(2);

    expect(candidates[0]?.title).toBe("Decentralized Sync Engine");
    expect(candidates[0]?.description).toContain("Enables multi-device peer-to-peer sync");
    expect(candidates[0]?.source.locator).toBe("doc_heading_456");

    expect(candidates[1]?.title).toBe("Zero-Knowledge Relays");
    expect(candidates[1]?.description).toContain("Blind message routing");
  });

  it("computes deterministic itemKeys = sha256(documentId + normalizedText)", () => {
    const key1 = computeDocItemKey("doc_1", "Feature A");
    const key2 = computeDocItemKey("doc_1", "feature a ");
    const keyDiffDoc = computeDocItemKey("doc_2", "Feature A");

    expect(key1).toBe(key2); // Case & whitespace normalized
    expect(key1).not.toBe(keyDiffDoc); // Different documentId yields different key
  });

  it("reports unavailable documents in unavailable array without throwing", async () => {
    const res = await plugin.fetch({
      mode: "import",
      input: { form: { documentId: "missing_document_999" } },
    });

    expect(res.candidates).toEqual([]);
    expect(res.unavailable).toBeDefined();
    expect(res.unavailable?.length).toBe(1);
    expect(res.unavailable?.[0]?.locator).toBe("missing_document_999");
  });
});
