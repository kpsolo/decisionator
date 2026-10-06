import type { ProjectSnapshot, Unsubscribe } from "@decisionator/plugin-sdk";
import { guestSessionKey, randomId } from "./crypto.js";
import type { Link } from "./link.js";
import {
  type AckErrorCode,
  type GuestEntry,
  type GuestMessage,
  HostMessageSchema,
  type LiveRole,
  PROTOCOL_VERSION,
} from "./protocol.js";

export type LiveGuestStatus =
  /** Looking for the host (first connection). */
  | "connecting"
  /** Connected and up to date. */
  | "live"
  /** Lost the host; retrying. Submissions are refused until it is back. */
  | "reconnecting"
  /** The host ended the session. The last snapshot stays available. */
  | "ended"
  /** Gave up, or the host refused us. `retry()` starts over. */
  | "failed";

export interface LiveGuestState {
  status: LiveGuestStatus;
  snapshot: ProjectSnapshot | null;
  participantId: string | null;
  role: LiveRole | null;
  /** Why the session ended or failed. */
  message?: string;
}

export class SubmitError extends Error {
  constructor(
    readonly code: AckErrorCode | "offline" | "timeout",
    message: string
  ) {
    super(message);
    this.name = "SubmitError";
  }
}

export interface LiveShareGuestOptions {
  sessionId: string;
  /** Device-wide secret the guest's identity is derived from (kept in local storage). */
  deviceSecret: string;
  displayName: string;
  /** Opens a new link to the host, or rejects when the host cannot be reached. */
  dial: (signal: AbortSignal) => Promise<Link>;
  /** Wait for a welcome after connecting. */
  welcomeTimeoutMs?: number;
  /** Wait for the host to confirm a submission. */
  ackTimeoutMs?: number;
  /** Stop retrying after this long without a connection. */
  giveUpAfterMs?: number;
  maxRetryDelayMs?: number;
}

interface Pending {
  resolve: () => void;
  reject: (err: SubmitError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The guest side of a live session. */
export class LiveShareGuest {
  private readonly opts: Required<Omit<LiveShareGuestOptions, "dial">> &
    Pick<LiveShareGuestOptions, "dial">;
  private state: LiveGuestState = {
    status: "connecting",
    snapshot: null,
    participantId: null,
    role: null,
  };
  private rev = -1;
  private link: Link | null = null;
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private offlineSince = 0;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(state: LiveGuestState) => void>();
  private stopped = false;

  constructor(opts: LiveShareGuestOptions) {
    this.opts = {
      welcomeTimeoutMs: 10_000,
      ackTimeoutMs: 10_000,
      giveUpAfterMs: 120_000,
      maxRetryDelayMs: 10_000,
      ...opts,
    };
  }

  start(): void {
    this.stopped = false;
    this.offlineSince = Date.now();
    this.attempt = 0;
    void this.connect();
  }

  /** Starts over after `failed`. */
  retry(): void {
    if (this.state.status !== "failed") return;
    this.set({ status: this.state.snapshot ? "reconnecting" : "connecting", message: undefined });
    this.start();
  }

  getState(): LiveGuestState {
    return this.state;
  }

  subscribe(cb: (state: LiveGuestState) => void): Unsubscribe {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Resolves once the host has saved the entries; rejects with a {@link SubmitError}. */
  submit(entries: GuestEntry[]): Promise<void> {
    const link = this.link;
    if (this.state.status !== "live" || !link) {
      return Promise.reject(
        new SubmitError("offline", "Not connected to the host. Your change was not saved.")
      );
    }
    const id = randomId(8);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SubmitError("timeout", "The host did not confirm your change."));
      }, this.opts.ackTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(link, { t: "submit", id, entries });
    });
  }

  leave(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.abort?.abort();
    const link = this.link;
    this.link = null;
    if (link) {
      this.send(link, { t: "bye" });
      link.close("left");
    }
    this.failPending("You left the session.");
    this.listeners.clear();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.abort = new AbortController();
    let link: Link;
    try {
      link = await this.opts.dial(this.abort.signal);
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.stopped) {
      link.close("left");
      return;
    }
    this.link = link;

    const welcomeTimer = setTimeout(() => link.close("no welcome"), this.opts.welcomeTimeoutMs);
    link.onMessage((raw) => this.onMessage(link, raw, welcomeTimer));
    link.onClose(() => {
      clearTimeout(welcomeTimer);
      if (this.link !== link) return;
      this.link = null;
      this.failPending("Lost the connection to the host. Your change may not have been saved.");
      if (this.stopped || this.state.status === "ended" || this.state.status === "failed") return;
      if (this.state.status === "live") {
        this.offlineSince = Date.now();
        this.attempt = 0;
        this.set({ status: "reconnecting" });
      }
      this.scheduleRetry();
    });

    this.send(link, {
      t: "hello",
      proto: PROTOCOL_VERSION,
      key: guestSessionKey(this.opts.deviceSecret, this.opts.sessionId),
      name: this.opts.displayName,
    });
  }

  private onMessage(link: Link, raw: unknown, welcomeTimer: ReturnType<typeof setTimeout>): void {
    const parsed = HostMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    switch (msg.t) {
      case "welcome":
        clearTimeout(welcomeTimer);
        this.attempt = 0;
        this.rev = msg.rev;
        this.set({
          status: "live",
          participantId: msg.participantId,
          role: msg.role,
          snapshot: msg.snapshot as unknown as ProjectSnapshot,
          message: undefined,
        });
        break;
      case "snapshot":
        if (msg.rev <= this.rev) return;
        this.rev = msg.rev;
        this.set({ snapshot: msg.snapshot as unknown as ProjectSnapshot });
        break;
      case "ack": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve();
        else
          p.reject(
            new SubmitError(msg.code ?? "invalid", msg.message ?? "The host rejected the change.")
          );
        break;
      }
      case "closing":
        this.stopped = true;
        this.set({ status: "ended", message: msg.reason });
        link.close("host closed");
        break;
      case "error":
        this.stopped = true;
        this.set({ status: "failed", message: msg.message });
        link.close(msg.code);
        break;
    }
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    if (Date.now() - this.offlineSince > this.opts.giveUpAfterMs) {
      this.set({
        status: "failed",
        message: this.state.snapshot
          ? "The host is no longer reachable."
          : "Could not reach the host. Check that their session is still running.",
      });
      return;
    }
    const delay = Math.min(this.opts.maxRetryDelayMs, 1000 * 2 ** this.attempt);
    this.attempt++;
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private failPending(message: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new SubmitError("offline", message));
    }
    this.pending.clear();
  }

  private send(link: Link, message: GuestMessage): void {
    link.send(message);
  }

  private set(patch: Partial<LiveGuestState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }
}
