import { runProjectStoreContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { FirestoreProjectStore } from "../src/firestore-store.js";

describe("FirestoreProjectStore Contract Compliance", () => {
  // Shared store instance simulates Firestore collection behavior for multiple participants
  const sharedStoreMap = new Map<string, FirestoreProjectStore>();

  runProjectStoreContractTests(async (opts) => {
    const user = opts?.currentUserEmail || "alice@example.com";
    let store = sharedStoreMap.get(user);
    if (!store) {
      // Create user store sharing underlying collections
      const primary = sharedStoreMap.get("alice@example.com");
      store = new FirestoreProjectStore(user);
      if (primary) {
        // Link collections for multi-user test cases
        const target = store as unknown as Record<string, unknown>;
        const src = primary as unknown as Record<string, unknown>;
        target.projects = src.projects;
        target.options = src.options;
        target.entries = src.entries;
      }
      sharedStoreMap.set(user, store);
    }
    return store;
  });
});
