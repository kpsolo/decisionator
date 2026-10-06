import type {
  ActiveStorageConfig,
  ProjectRef,
  ProjectStore,
  ProjectSummary,
  StorageManagerContract,
} from "@decisionator/plugin-sdk";

const ACTIVE_STORE_KEY = "decisionator_active_store";
const CONFIG_KEY = "decisionator_storage_config";

export class StorageManager implements StorageManagerContract {
  private stores = new Map<string, ProjectStore>();
  private activeStoreId: string;

  constructor(defaultStoreId = "file") {
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_STORE_KEY) : null;
    this.activeStoreId = saved || defaultStoreId;
  }

  registerStore(store: ProjectStore): void {
    this.stores.set(store.id, store);
  }

  unregisterStore(storeId: string): void {
    this.stores.delete(storeId);
  }

  getRegisteredStores(): ProjectStore[] {
    return Array.from(this.stores.values());
  }

  getStore(storeId: string): ProjectStore | undefined {
    return this.stores.get(storeId);
  }

  getActiveStore(): ProjectStore {
    const active = this.stores.get(this.activeStoreId);
    if (active) return active;

    // Fallback: try "file", then first registered store
    const fileStore = this.stores.get("file") || this.stores.get("org.decisionator.store.file");
    if (fileStore) return fileStore;

    const first = this.stores.values().next().value;
    if (first) return first;

    throw new Error("No storage providers registered in StorageManager");
  }

  getActiveStoreId(): string {
    return this.activeStoreId;
  }

  setActiveStore(storeId: string): void {
    this.activeStoreId = storeId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACTIVE_STORE_KEY, storeId);
    }
  }

  resolveStore(ref: ProjectRef): ProjectStore {
    if (ref.store) {
      // Check exact match
      const direct = this.stores.get(ref.store);
      if (direct) return direct;

      // Check match by short id or long id
      for (const [id, s] of this.stores.entries()) {
        if (id === ref.store || id.endsWith(`.${ref.store}`) || ref.store.endsWith(`.${id}`)) {
          return s;
        }
      }
    }
    return this.getActiveStore();
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

  saveConfig(config: ActiveStorageConfig): void {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
    if (config.activeStoreId) {
      this.setActiveStore(config.activeStoreId);
    }
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
    } catch {
      // Ignored if google config fails
    }
  }
  return instance;
}
