import { describe, expect, it } from "vitest";
import type { IdeaSourcePlugin, IdeaSourceRequest } from "../src/idea-source.js";

export interface IdeaSourceTestFixtures {
  validRequest?: IdeaSourceRequest;
  unavailableRequest?: IdeaSourceRequest;
}

/**
 * Runs contract tests verifying any implementation of IdeaSourcePlugin
 * against the specification in contracts/idea-source.md.
 */
export function runIdeaSourceContractTests(
  plugin: IdeaSourcePlugin,
  fixtures: IdeaSourceTestFixtures = {}
): void {
  describe(`IdeaSource Contract: ${plugin.constructor?.name ?? "Plugin"}`, () => {
    const sampleRequest: IdeaSourceRequest = fixtures.validRequest ?? {
      mode: "import",
      input: {
        clipboardText:
          "Candidate One\nCandidate Two: A short summary\nCandidate Three — Another summary",
      },
    };

    it("ensures candidate titles are within 1–200 characters after trim", async () => {
      const res = await plugin.fetch(sampleRequest);
      expect(res.candidates.length).toBeGreaterThan(0);
      for (const c of res.candidates) {
        expect(c.title.trim().length).toBeGreaterThanOrEqual(1);
        expect(c.title.trim().length).toBeLessThanOrEqual(200);
      }
    });

    it("ensures itemKeys are unique within a result and stable across runs", async () => {
      const res1 = await plugin.fetch(sampleRequest);
      const res2 = await plugin.fetch(sampleRequest);

      const keys1 = res1.candidates.map((c) => c.source.itemKey);
      const keys2 = res2.candidates.map((c) => c.source.itemKey);

      expect(new Set(keys1).size).toBe(keys1.length);
      expect(keys1).toEqual(keys2);
    });

    it("returns same keys on refresh with unchanged source", async () => {
      const res = await plugin.fetch(sampleRequest);
      const refreshReq: IdeaSourceRequest = {
        mode: "refresh",
        input: sampleRequest.input,
        previous: [
          {
            locator: res.candidates[0]?.source.locator ?? "",
            itemKeys: res.candidates.map((c) => c.source.itemKey),
          },
        ],
      };
      const refreshRes = await plugin.fetch(refreshReq);
      const refreshKeys = refreshRes.candidates.map((c) => c.source.itemKey);
      const originalKeys = res.candidates.map((c) => c.source.itemKey);
      expect(refreshKeys).toEqual(originalKeys);
    });

    if (fixtures.unavailableRequest) {
      it("reports unavailable sources instead of throwing uncaught exceptions", async () => {
        const res = await plugin.fetch(fixtures.unavailableRequest as IdeaSourceRequest);
        expect(res.unavailable).toBeDefined();
        expect(res.unavailable?.length).toBeGreaterThan(0);
      });
    }
  });
}
