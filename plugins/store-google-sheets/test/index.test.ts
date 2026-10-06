import { describe, expect, it } from "vitest";
import { STORE_GOOGLE_SHEETS_ID } from "../src/index.js";

describe("store-google-sheets", () => {
  it("exports its id", () => {
    expect(STORE_GOOGLE_SHEETS_ID).toBe("org.decisionator.store.google-sheets");
  });
});
