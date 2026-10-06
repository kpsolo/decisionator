import "fake-indexeddb/auto";
import { runProjectStoreContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleSheetsProjectStore } from "../src/sheet-store.js";

describe("GoogleSheetsProjectStore Contract Compliance (T037)", () => {
  runProjectStoreContractTests(async (opts) => {
    const auth = new GoogleAuthService({ clientId: "test-client" });
    auth.setTokenInMemory("fake-token-123");
    if (opts?.currentUserEmail) {
      // In tests, the fake Google server handles current user based on fakeGoogleState
    }
    return new GoogleSheetsProjectStore(auth);
  });
});
