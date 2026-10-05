import { describe, expect, it } from "vitest";
import { SOURCE_PASTE_ID } from "../src/index.js";

describe("source-paste", () => {
  it("exports its id", () => {
    expect(SOURCE_PASTE_ID).toBe("org.decisionator.source.paste");
  });
});
