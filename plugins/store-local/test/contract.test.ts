import "fake-indexeddb/auto";
import { runProjectStoreContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { LocalProjectStore } from "../src/store.js";

describe("LocalProjectStore Contract Compliance (T115, FR-070, FR-071)", () => {
  // Use a shared database name so multiple store instances (e.g. Alice and Bob) see the same underlying storage
  const sharedDbName = "decisionator_test_shared_local_db";

  runProjectStoreContractTests(async (opts) => {
    return new LocalProjectStore(opts?.currentUserEmail || "alice@example.com", sharedDbName);
  });
});
