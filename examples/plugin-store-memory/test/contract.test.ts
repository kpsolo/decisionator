import { runProjectStoreContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { MemoryBackend, MemoryProjectStore } from "../src/index.js";

describe("MemoryProjectStore Contract Compliance", () => {
  // One backend shared by every signed-in user, like a real remote store.
  const backend = new MemoryBackend();

  runProjectStoreContractTests(async (opts) => {
    return new MemoryProjectStore(opts?.currentUserEmail || "alice@example.com", backend);
  });
});
