import type { ProjectStore } from "@decisionator/plugin-sdk";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { type StorageManager, getStorageManager } from "./storage-manager.js";

interface StorageContextValue {
  storageManager: StorageManager;
  activeStoreId: string;
  activeStore: ProjectStore;
  setActiveStoreId: (id: string) => void;
  registeredStores: ProjectStore[];
}

const StorageContext = createContext<StorageContextValue | null>(null);

export const StorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sm] = useState(() => getStorageManager());
  const [activeStoreId, setActiveStoreIdState] = useState(() => sm.getActiveStoreId());
  const [activeStore, setActiveStore] = useState<ProjectStore>(() => sm.getActiveStore());
  const [registeredStores, setRegisteredStores] = useState<ProjectStore[]>(() =>
    sm.getRegisteredStores()
  );

  const setActiveStoreId = (id: string) => {
    sm.setActiveStore(id);
    setActiveStoreIdState(id);
    setActiveStore(sm.getActiveStore());
    setRegisteredStores(sm.getRegisteredStores());
  };

  useEffect(() => {
    setActiveStore(sm.getActiveStore());
    setRegisteredStores(sm.getRegisteredStores());
  }, [sm]);

  return (
    <StorageContext.Provider
      value={{
        storageManager: sm,
        activeStoreId,
        activeStore,
        setActiveStoreId,
        registeredStores,
      }}
    >
      {children}
    </StorageContext.Provider>
  );
};

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) {
    const sm = getStorageManager();
    return {
      storageManager: sm,
      activeStoreId: sm.getActiveStoreId(),
      activeStore: sm.getActiveStore(),
      setActiveStoreId: (id: string) => sm.setActiveStore(id),
      registeredStores: sm.getRegisteredStores(),
    };
  }
  return ctx;
}
