import type {
  ActiveStorageConfig,
  ProjectRef,
  ProjectStore,
  ProjectSummary,
  StorageManagerContract,
} from "@decisionator/plugin-sdk";

const ACTIVE_STORE_KEY = "decisionator_active_store";
const CONFIG_KEY = "decisionator_storage_config";
const BUILT_IN_PREFIX = "org.decisionator.store.";

/**
 * Short form of a store id, as project routes, `ProjectRef.store` and Storage Settings use it:
 * built-in stores drop the `org.decisionator.store.` prefix ("org.decisionator.store.file" →
 * "file"); other ids are kept whole.
 */
export function shortStoreId(storeId: string): string {
  return storeId.startsWith(BUILT_IN_PREFIX) ? storeId.slice(BUILT_IN_PREFIX.length) : storeId;
}

/** The error for a store id that names no registered store (ProjectStore rule 3). */
function storeUnavailable(storeId: string): Error {
  return new Error(
    `NOT_SUPPORTED: Storage "${storeId}" is not available in this app, so its projects cannot be opened here`
  );
}

export class StorageManager implements StorageManagerContract {
  private stores = new Map<string, ProjectStore>();
  /** Short id of the chosen store (see `shortStoreId`). */
  private activeStoreId: string;

  constructor(defaultStoreId = "file") {
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_STORE_KEY) : null;
    this.activeStoreId = shortStoreId(saved || defaultStoreId);
  }

  registerStore(store: ProjectStore): void {
    this.stores.set(store.id, store);
  }

  unregisterStore(storeId: string): void {
    const store = this.find(storeId);
    if (store) this.stores.delete(store.id);
  }

  getRegisteredStores(): ProjectStore[] {
    return Array.from(this.stores.values());
  }

  /** The registered store with this id, given in its full or short form. */
  getStore(storeId: string): ProjectStore | undefined {
    return this.find(storeId);
  }

  /**
   * The chosen store. When the persisted choice names a store that is not registered in this
   * build (e.g. Google Sheets without its configuration), the local file store is used instead,
   * then the first registered store.
   */
  getActiveStore(): ProjectStore {
    const active = this.find(this.activeStoreId);
    if (active) return active;

    const fileStore = this.find("file");
    if (fileStore) return fileStore;

    const first = this.stores.values().next().value;
    if (first) return first;

    throw new Error("No storage providers registered in StorageManager");
  }

  getActiveStoreId(): string {
    return this.activeStoreId;
  }

  /** Chooses the store for new projects; throws `NOT_SUPPORTED` for a store not registered. */
  setActiveStore(storeId: string): void {
    const store = this.find(storeId);
    if (!store) throw storeUnavailable(storeId);
    this.activeStoreId = shortStoreId(store.id);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACTIVE_STORE_KEY, this.activeStoreId);
    }
  }

  /**
   * The store that holds `ref`. A ref without a store resolves to the active store; a ref of a
   * store that is not registered throws `NOT_SUPPORTED` rather than opening another store.
   */
  resolveStore(ref: ProjectRef): ProjectStore {
    if (!ref.store) return this.getActiveStore();
    const store = this.find(ref.store);
    if (!store) throw storeUnavailable(ref.store);
    return store;
  }

  async listAllProjects(): Promise<ProjectSummary[]> {
    const results: ProjectSummary[] = [];
    for (const store of this.stores.values()) {
      try {
        const list = await store.listProjects();
        results.push(...list);
      } catch {
        // Skip stores that are not signed in or fail to list
      }
    }
    return results;
  }

  getConfig(): ActiveStorageConfig {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CONFIG_KEY) : null;
      if (raw) return JSON.parse(raw) as ActiveStorageConfig;
    } catch {
      // Fallback
    }
    return {
      activeStoreId: this.activeStoreId,
      configuredStores: {},
    };
  }

  /** Saves the storage configuration; refuses (and saves nothing) for an unknown active store. */
  saveConfig(config: ActiveStorageConfig): void {
    if (config.activeStoreId && !this.find(config.activeStoreId)) {
      throw storeUnavailable(config.activeStoreId);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
    if (config.activeStoreId) {
      this.setActiveStore(config.activeStoreId);
    }
  }

  /**
   * Finds a registered store by its full id ("org.decisionator.store.firestore") or short id
   * ("firestore"), whichever form it was registered or asked for with. Only exact matches count:
   * a third-party id that merely ends in a built-in's name ("evil.store.file") never stands in
   * for it, and vice versa.
   */
  private find(storeId: string): ProjectStore | undefined {
    if (!storeId) return undefined;
    const direct = this.stores.get(storeId);
    if (direct) return direct;
    const short = shortStoreId(storeId);
    for (const [id, store] of this.stores) {
      if (shortStoreId(id) === short) return store;
    }
    return undefined;
  }
}

import { FileProjectStore } from "@decisionator/store-file";
import { FirestoreProjectStore } from "@decisionator/store-firestore";
import { GoogleAuthService, GoogleSheetsProjectStore } from "@decisionator/store-google-sheets";
import { getGoogleConfig } from "../config/google.js";

let instance: StorageManager | null = null;

export function getStorageManager(): StorageManager {
  if (!instance) {
    instance = new StorageManager("file");

    // Register File store as primary local store
    const fileStore = new FileProjectStore();
    instance.registerStore(fileStore);

    // Register Firestore store
    const firestoreStore = new FirestoreProjectStore();
    instance.registerStore(firestoreStore);

    // Register Google Sheets store
    try {
      const config = getGoogleConfig();
      const auth = new GoogleAuthService({ clientId: config.clientId });
      const googleStore = new GoogleSheetsProjectStore(auth);
      instance.registerStore(googleStore);
      // Sends rows queued while offline or rate-limited without waiting for the next edit.
      googleStore.startAutoFlush();
    } catch {
      // Ignored if google config fails
    }
  }
  return instance;
}
