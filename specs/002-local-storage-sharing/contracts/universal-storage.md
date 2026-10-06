# Contract: Universal Storage Manager — v1.0.0

The Universal Storage Manager coordinates `ProjectStore` implementations, allows switching the "Activated Storage", and routes project references (`ProjectRef`) to the appropriate backend.

## Interface (`@decisionator/plugin-sdk` & `apps/web`)

```ts
import type { ProjectRef, ProjectSnapshot, ProjectStore, ProjectSummary } from "@decisionator/plugin-sdk";

export interface StorageManager {
  /**
   * Registers a storage provider instance with a unique store identifier.
   */
  registerStore(store: ProjectStore): void;

  /**
   * Returns all currently registered storage providers.
   */
  getRegisteredStores(): ProjectStore[];

  /**
   * Returns the currently active storage provider.
   * If none is activated by the user, returns the fallback FileProjectStore.
   */
  getActiveStore(): ProjectStore;

  /**
   * Sets the active storage provider identifier (e.g. "file", "firestore", "google-sheets").
   */
  setActiveStore(storeId: string): void;

  /**
   * Resolves a ProjectRef to its corresponding store instance.
   */
  resolveStore(ref: ProjectRef): ProjectStore;

  /**
   * Unified list of recent/known projects across all registered stores.
   */
  listAllProjects(): Promise<ProjectSummary[]>;
}
```

## URL Routing Convention
- `/p/:storeId/:id` — Standard format targeting a specific storage backend.
- `/p/:id` — Legacy fallback format; routes to the current active store, or resolves via store ID heuristics.
