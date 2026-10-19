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

const fileStore = { id: "org.decisionator.store.file" } as unknown as ProjectStore;
const firestoreStore = { id: "org.decisionator.store.firestore" } as unknown as ProjectStore;
const sheetsStore = { id: "org.decisionator.store.google-sheets" } as unknown as ProjectStore;

describe("StorageManager Universal Registry & Resolution", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it("defaults active store to 'file' and persists selection in localStorage", () => {
    const sm = new StorageManager("file");
    expect(sm.getActiveStoreId()).toBe("file");
    sm.registerStore(fileStore);
    sm.registerStore(firestoreStore);

    sm.setActiveStore("firestore");
    expect(sm.getActiveStoreId()).toBe("firestore");
    expect(localStorage.getItem("decisionator_active_store")).toBe("firestore");

    const reloaded = new StorageManager("file");
    expect(reloaded.getActiveStoreId()).toBe("firestore");
  });

  it("activates a store chosen by its short id (as Storage Settings saves it)", () => {
    const sm = new StorageManager("file");
    sm.registerStore(fileStore);
    sm.registerStore(firestoreStore);
    sm.registerStore(sheetsStore);

    sm.setActiveStore("google-sheets");
    expect(sm.getActiveStore()).toBe(sheetsStore);

    sm.saveConfig({ activeStoreId: "firestore" });
    expect(sm.getActiveStore()).toBe(firestoreStore);
    expect(new StorageManager("file").getActiveStoreId()).toBe("firestore");
  });

  it("accepts the full store id too and keeps the short form as the active id", () => {
    const sm = new StorageManager("file");
    sm.registerStore(fileStore);
    sm.registerStore(firestoreStore);

    sm.setActiveStore("org.decisionator.store.firestore");
    expect(sm.getActiveStore()).toBe(firestoreStore);
    expect(sm.getActiveStoreId()).toBe("firestore");
    expect(sm.getStore("firestore")).toBe(firestoreStore);
    expect(sm.getStore("org.decisionator.store.file")).toBe(fileStore);
  });

  it("refuses to activate a store that is not registered", () => {
    const sm = new StorageManager("file");
    sm.registerStore(fileStore);

    expect(() => sm.setActiveStore("google-sheets")).toThrow(/^NOT_SUPPORTED/);
    expect(sm.getActiveStoreId()).toBe("file");
    expect(localStorage.getItem("decisionator_active_store")).toBeNull();
  });

  it("refuses to resolve a project of a store that is not registered", () => {
    const sm = new StorageManager("file");
    sm.registerStore(fileStore);

    expect(() => sm.resolveStore({ store: "local", id: "loc_1" })).toThrow(/^NOT_SUPPORTED/);
    expect(sm.resolveStore({ store: "", id: "file_1" })).toBe(fileStore);
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
