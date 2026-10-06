import type { ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";
import {
  type HostingSession,
  type LiveHostState,
  hostedProjectFromStore,
  startHosting,
} from "@decisionator/share-inpage";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { hostCredentialsFor, loadNetworkConfig } from "./live-config.js";

export interface LiveTarget {
  store: ProjectStore;
  projectRef: ProjectRef;
  projectTitle: string;
}

export interface ActiveLiveSession {
  key: string;
  target: LiveTarget;
  /** `/p/:storeId/:id` of the hosted project. */
  projectPath: string;
  hosting: HostingSession;
  state: LiveHostState;
}

interface LiveShareContextValue {
  session: ActiveLiveSession | null;
  /** The project the dialog is about, or null when the dialog is closed. */
  dialogTarget: LiveTarget | null;
  starting: boolean;
  startError: string | null;
  /** Opens the dialog for a project; starts hosting it if nothing else is live. */
  openFor(target: LiveTarget): void;
  /** Reopens the dialog for the running session. */
  openActive(): void;
  closeDialog(): void;
  start(target: LiveTarget): Promise<void>;
  stop(reason?: string): void;
}

const LiveShareContext = createContext<LiveShareContextValue | null>(null);

export function projectKey(ref: ProjectRef): string {
  return `${ref.store}:${ref.id}`;
}

/**
 * Owns the hosted live session for the whole app, so it survives navigation between project
 * pages and closing the dialog. It ends only when the host ends it or closes the tab.
 */
export function LiveShareProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ActiveLiveSession | null>(null);
  const [dialogTarget, setDialogTarget] = useState<LiveTarget | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const sessionRef = useRef<ActiveLiveSession | null>(null);
  sessionRef.current = session;

  const stop = useCallback((reason?: string) => {
    sessionRef.current?.hosting.close(reason);
    sessionRef.current = null;
    setSession(null);
  }, []);

  const start = useCallback(async (target: LiveTarget) => {
    const key = projectKey(target.projectRef);
    if (sessionRef.current?.key === key) return;
    sessionRef.current?.hosting.close("The host moved the session to another project.");
    setSession(null);
    setStarting(true);
    setStartError(null);
    try {
      const hosting = await startHosting({
        project: hostedProjectFromStore(target.store, target.projectRef),
        credentials: hostCredentialsFor(key),
        config: loadNetworkConfig(),
      });
      const next: ActiveLiveSession = {
        key,
        target,
        projectPath: `/p/${target.projectRef.store}/${target.projectRef.id}`,
        hosting,
        state: hosting.host.getState(),
      };
      sessionRef.current = next;
      setSession(next);
      hosting.host.subscribe((state) => {
        setSession((s) => (s && s.hosting === hosting ? { ...s, state } : s));
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStartError(
        /password/i.test(message)
          ? "This project is password-protected. Open it and unlock it first, then start the session."
          : message
      );
    } finally {
      setStarting(false);
    }
  }, []);

  const openFor = useCallback(
    (target: LiveTarget) => {
      setStartError(null);
      setDialogTarget(target);
      if (!sessionRef.current) void start(target);
    },
    [start]
  );

  const openActive = useCallback(() => {
    if (sessionRef.current) setDialogTarget(sessionRef.current.target);
  }, []);

  const closeDialog = useCallback(() => setDialogTarget(null), []);

  // Leaving the page ends the session: warn first if people are connected, then tell them.
  const guestCount = session?.state.guests.length ?? 0;
  useEffect(() => {
    if (!session) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (guestCount > 0) e.preventDefault();
    };
    const onPageHide = () => sessionRef.current?.hosting.close("The host closed their tab.");
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session, guestCount]);

  useEffect(() => () => sessionRef.current?.hosting.close("The host closed their tab."), []);

  const value = useMemo<LiveShareContextValue>(
    () => ({
      session,
      dialogTarget,
      starting,
      startError,
      openFor,
      openActive,
      closeDialog,
      start,
      stop,
    }),
    [session, dialogTarget, starting, startError, openFor, openActive, closeDialog, start, stop]
  );

  return <LiveShareContext.Provider value={value}>{children}</LiveShareContext.Provider>;
}

export function useLiveShare(): LiveShareContextValue {
  const ctx = useContext(LiveShareContext);
  if (!ctx) throw new Error("useLiveShare must be used inside <LiveShareProvider>");
  return ctx;
}
