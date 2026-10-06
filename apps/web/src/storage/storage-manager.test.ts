import "fake-indexeddb/auto";
import type { ProjectStore } from "@decisionator/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { StorageManager } from "./storage-manager.js";

const memoryStorage = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, val: string) => memoryStorage.set(key, val),
  removeItem: (key: string) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
};
// @ts-ignore
globalThis.localStorage = mockLocalStorage;

describe("StorageManager Universal Registry & Resolution", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it("defaults active store to 'file' and persists selection in localStorage", () => {
    const sm = new StorageManager("file");
    expect(sm.getActiveStoreId()).toBe("file");

    sm.setActiveStore("firestore");
    expect(sm.getActiveStoreId()).toBe("firestore");
    expect(localStorage.getItem("decisionator_active_store")).toBe("firestore");

    const reloaded = new StorageManager("file");
    expect(reloaded.getActiveStoreId()).toBe("firestore");
  });

  it("registers and resolves stores by exact ID or prefix", () => {
    const sm = new StorageManager("file");

    const mockStoreA = {
      id: "org.decisionator.store.file",
    } as unknown as ProjectStore;

    const mockStoreB = {
      id: "org.decisionator.store.firestore",
    } as unknown as ProjectStore;

    sm.registerStore(mockStoreA);
    sm.registerStore(mockStoreB);

    expect(sm.resolveStore({ store: "file", id: "123" })).toBe(mockStoreA);
    expect(sm.resolveStore({ store: "firestore", id: "456" })).toBe(mockStoreB);
    expect(sm.resolveStore({ store: "org.decisionator.store.file", id: "789" })).toBe(mockStoreA);
  });
});
