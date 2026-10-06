import "fake-indexeddb/auto";
import { runProjectStoreContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { FileProjectStore } from "../src/file-store.js";

describe("FileProjectStore Contract Compliance", () => {
  const sharedDbName = "decisionator_test_file_shared_db";

  runProjectStoreContractTests(async (opts) => {
    return new FileProjectStore(opts?.currentUserEmail || "alice@example.com", sharedDbName);
  });
});
