import type { ProjectRef, ProjectStore } from "@decisionator/plugin-sdk";
import {
  type HostingSession,
  type LiveHostState,
  type LiveRole,
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
import { getStorageManager } from "../../storage/storage-manager.js";
import { HostingStartGate } from "./hosting-gate.js";
import {
  hostCredentialsFor,
  loadNetworkConfig,
  markSessionRevoked,
  removeHostSessionIndex,
  rotateHostCredentials,
} from "./live-config.js";

export const ACTIVE_HOSTING_KEY = "deci.live.activeHosting";

export interface ActiveHostingDescriptor {
  projectRef: { store: string; id: string };
  projectTitle: string;
  sessionId: string;
  startedAt: string;
  lastHeartbeat: string;
}

export function clearActiveHosting(): void {
  try {
    sessionStorage.removeItem(ACTIVE_HOSTING_KEY);
  } catch {
    // ignore
  }
}

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
  setRole(role: LiveRole): void;
  /**
   * Revokes the hosted link (contract session-restore §6.1): guests are disconnected, the
   * credentials rotate, and unless `purgeRelays` is false a tombstone replaces the relay
   * snapshot. Resolves once relays confirmed it or the wait timed out.
   */
  revoke(reason?: string, opts?: { purgeRelays?: boolean }): Promise<void>;
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
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** One hosting start in flight at a time; stop/revoke cancel it (see HostingStartGate). */
  const gateRef = useRef(new HostingStartGate<HostingSession>());
  const mountedRef = useRef(false);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const stop = useCallback(
    (reason?: string) => {
      stopHeartbeat();
      clearActiveHosting();
      gateRef.current.cancel((hosting) => hosting.close(reason));
      sessionRef.current?.hosting.close(reason);
      sessionRef.current = null;
      setSession(null);
    },
    [stopHeartbeat]
  );

  const start = useCallback(async (target: LiveTarget) => {
    const key = projectKey(target.projectRef);
    if (sessionRef.current?.key === key) return;
    const gate = gateRef.current;
    const moved = "The host moved the session to another project.";
    if (sessionRef.current) {
      sessionRef.current.hosting.close(moved);
      sessionRef.current = null;
      setSession(null);
    }
    setStarting(true);
    setStartError(null);
    try {
      const creds = hostCredentialsFor(key);
      const hosting = await gate.start(
        key,
        () =>
          startHosting({
            project: hostedProjectFromStore(target.store, target.projectRef),
            credentials: creds,
            config: loadNetworkConfig(),
          }),
        (superseded) => superseded.close(moved)
      );
      // Cancelled by stop/revoke/another project meanwhile, or joined a start whose first
      // caller has already set the session up.
      // (Read through a widened type: the await may have changed the ref since it was cleared.)
      const active = sessionRef.current as ActiveLiveSession | null;
      if (!hosting || active?.hosting === hosting) return;
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

      // Persist active hosting descriptor for reload recovery (data-model §4)
      const desc: ActiveHostingDescriptor = {
        projectRef: target.projectRef,
        projectTitle: target.projectTitle,
        sessionId: creds.sessionId,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      try {
        sessionStorage.setItem(ACTIVE_HOSTING_KEY, JSON.stringify(desc));
      } catch {
        // ignore
      }

      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        try {
          const raw = sessionStorage.getItem(ACTIVE_HOSTING_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as ActiveHostingDescriptor;
            parsed.lastHeartbeat = new Date().toISOString();
            sessionStorage.setItem(ACTIVE_HOSTING_KEY, JSON.stringify(parsed));
          }
        } catch {
          // ignore
        }
      }, 30_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStartError(
        /password/i.test(message)
          ? "This project is password-protected. Open it and unlock it first, then start the session."
          : message
      );
    } finally {
      setStarting(gate.pendingKey !== null);
    }
  }, []);

  // Auto-resume hosting on mount if active hosting descriptor is present and < 1 hour old (FR-002, US1)
  useEffect(() => {
    mountedRef.current = true;
    const teardown = () => {
      // StrictMode unmounts and remounts at once (the re-run joins the start in flight), so only
      // tear down when the provider stays unmounted.
      setTimeout(() => {
        if (mountedRef.current) return;
        gateRef.current.cancel((hosting) => hosting.close());
        sessionRef.current?.hosting.close();
      }, 0);
    };
    try {
      const raw = sessionStorage.getItem(ACTIVE_HOSTING_KEY);
      if (raw) {
        const desc = JSON.parse(raw) as ActiveHostingDescriptor;
        const ageMs = Date.now() - new Date(desc.lastHeartbeat).getTime();
        if (ageMs > 3600 * 1000) {
          clearActiveHosting();
        } else {
          const sm = getStorageManager();
          const store = sm.resolveStore(desc.projectRef);
          void start({
            store,
            projectRef: desc.projectRef,
            projectTitle: desc.projectTitle,
          });
        }
      }
    } catch {
      // ignore
    }
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [start]);

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

  // Warn before closing tab if guests are connected, and notify guests on pagehide
  const guestCount = session?.state.guests.length ?? 0;
  useEffect(() => {
    if (!session) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (guestCount > 0) e.preventDefault();
    };
    const onPageHide = () => {
      sessionRef.current?.hosting.close("The host closed their tab.");
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session, guestCount]);

  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  const setRole = useCallback((role: LiveRole) => {
    if (sessionRef.current) {
      sessionRef.current.hosting.host.setRole(role);
      setSession((prev) => (prev ? { ...prev, state: prev.hosting.host.getState() } : null));
    }
  }, []);

  const revoke = useCallback(
    async (
      reason = "This session link has been revoked by the owner.",
      opts: { purgeRelays?: boolean } = {}
    ) => {
      const current = sessionRef.current;
      // A start still in flight must not come back to life: its host is revoked on arrival.
      const pendingKey = gateRef.current.cancel((hosting) => {
        void hosting.revoke(reason, opts);
      });
      const key = current?.key ?? pendingKey;
      if (key) {
        const credentials = current?.hosting.credentials ?? hostCredentialsFor(key);
        markSessionRevoked(credentials.sessionId, reason);
        removeHostSessionIndex(credentials.sessionId);
        rotateHostCredentials(key);
      }
      stopHeartbeat();
      sessionRef.current = null;
      clearActiveHosting();
      setSession(null);
      // Disconnects guests at once; resolves when relays confirmed the tombstone (or timed out).
      if (current) await current.hosting.revoke(reason, opts);
    },
    [stopHeartbeat]
  );

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
      setRole,
      revoke,
    }),
    [
      session,
      dialogTarget,
      starting,
      startError,
      openFor,
      openActive,
      closeDialog,
      start,
      stop,
      setRole,
      revoke,
    ]
  );

  return <LiveShareContext.Provider value={value}>{children}</LiveShareContext.Provider>;
}

export function useLiveShare(): LiveShareContextValue {
  const ctx = useContext(LiveShareContext);
  if (!ctx) throw new Error("useLiveShare must be used inside <LiveShareProvider>");
  return ctx;
}
