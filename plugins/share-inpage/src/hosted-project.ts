import type {
  Delegate,
  Entry,
  ProjectRef,
  ProjectSnapshot,
  ProjectStore,
  Unsubscribe,
} from "@decisionator/plugin-sdk";

/**
 * The project a live session serves. The host only reads snapshots and records entries for
 * guests; how the project is stored (local file, Firestore, Sheets) is the store's business.
 */
export interface HostedProject {
  /** Current decrypted snapshot, as the owner sees it. */
  snapshot(): Promise<ProjectSnapshot>;
  watch(onChange: (snapshot: ProjectSnapshot) => void): Unsubscribe;
  /** Records guest entries attributed to `participant` (ProjectStore contract v1.2.0). */
  appendFor(participant: Delegate, entries: Entry[]): Promise<void>;
}

/**
 * Serves a project straight from its store. The store must already be able to open the project
 * without a password, i.e. a protected project has been unlocked in this tab.
 */
export function hostedProjectFromStore(store: ProjectStore, ref: ProjectRef): HostedProject {
  return {
    snapshot: () => store.openProject(ref),
    watch: (onChange) => store.watch(ref, onChange),
    async appendFor(participant, entries) {
      await store.append(ref, entries, { onBehalfOf: participant });
    },
  };
}
