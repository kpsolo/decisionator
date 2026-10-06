import type { ProjectRef, ProjectStore, ProjectSummary } from "./project-store.js";

export interface ActiveStorageConfig {
  activeStoreId: string;
  configuredStores?: Record<string, Record<string, unknown>>;
}

export interface StorageManagerContract {
  registerStore(store: ProjectStore): void;
  unregisterStore(storeId: string): void;
  getRegisteredStores(): ProjectStore[];
  getStore(storeId: string): ProjectStore | undefined;
  getActiveStore(): ProjectStore;
  setActiveStore(storeId: string): void;
  resolveStore(ref: ProjectRef): ProjectStore;
  listAllProjects(): Promise<ProjectSummary[]>;
}
