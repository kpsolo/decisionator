import { describe, expect, it } from "vitest";
import { readStoredByName, resolveDelegatedAuthor } from "../src/delegation.js";
import type { Entry } from "../src/project-store.js";

const grade: Entry = { kind: "grade", optionId: "o1", value: 3 };

describe("resolveDelegatedAuthor", () => {
  it("returns undefined for an ordinary append", () => {
    expect(resolveDelegatedAuthor([grade], undefined, false)).toBeUndefined();
    expect(resolveDelegatedAuthor([grade], {}, true)).toBeUndefined();
  });

  it("stamps the delegate id and the trimmed display name", () => {
    expect(
      resolveDelegatedAuthor(
        [grade],
        { onBehalfOf: { participantId: "peer:a", displayName: " Ann " } },
        true
      )
    ).toEqual({ by: "peer:a", byName: "Ann" });
    expect(
      resolveDelegatedAuthor([grade], { onBehalfOf: { participantId: "peer:a" } }, true)
    ).toEqual({
      by: "peer:a",
    });
  });

  it("rejects malformed delegates with INVALID_ARGUMENT", () => {
    for (const onBehalfOf of [
      { participantId: "" },
      { participantId: "   " },
      { participantId: "x".repeat(201) },
      { participantId: "peer:a", displayName: "" },
      { participantId: "peer:a", displayName: "n".repeat(81) },
      { participantId: 42 as unknown as string },
    ]) {
      expect(() => resolveDelegatedAuthor([grade], { onBehalfOf }, true)).toThrow(
        /^INVALID_ARGUMENT/
      );
    }
    expect(
      resolveDelegatedAuthor([grade], { onBehalfOf: { participantId: "x".repeat(200) } }, true)?.by
    ).toHaveLength(200);
  });

  it("rejects non-owners and non-delegatable entry kinds with PERMISSION_DENIED", () => {
    const onBehalfOf = { participantId: "peer:a" };
    expect(() => resolveDelegatedAuthor([grade], { onBehalfOf }, false)).toThrow(
      /^PERMISSION_DENIED/
    );
    const contribution = {
      kind: "contribution",
      contribution: {},
    } as unknown as Entry;
    expect(() => resolveDelegatedAuthor([grade, contribution], { onBehalfOf }, true)).toThrow(
      /^PERMISSION_DENIED/
    );
  });
});

describe("readStoredByName", () => {
  it("accepts 1 to 80 character names and ignores anything else", () => {
    expect(readStoredByName(" Ann ")).toBe("Ann");
    expect(readStoredByName("")).toBeUndefined();
    expect(readStoredByName("n".repeat(81))).toBeUndefined();
    expect(readStoredByName(42)).toBeUndefined();
    expect(readStoredByName(undefined)).toBeUndefined();
  });
});
