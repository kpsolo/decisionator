import type { ProjectSnapshot, Unsubscribe } from "@decisionator/plugin-sdk";
import { participantIdFromKey } from "./crypto.js";
import type { HostedProject } from "./hosted-project.js";
import type { Link } from "./link.js";
import { checkSubmission, redactSnapshotFor } from "./policy.js";
import {
  type AckErrorCode,
  GuestMessageSchema,
  type HostMessage,
  type LiveRole,
  PROTOCOL_VERSION,
} from "./protocol.js";

export interface LiveGuestInfo {
  participantId: string;
  name: string;
  /** Open links for this participant (several tabs count once). */
  connections: number;
  joinedAt: string;
}

export interface LiveHostState {
  status: "starting" | "live" | "closed";
  guests: LiveGuestInfo[];
}

export interface LiveShareHostOptions {
  project: HostedProject;
  role?: LiveRole;
  /** Most simultaneous links; further guests are turned away. */
  maxLinks?: number;
  /** Time a new link has to say hello. */
  helloTimeoutMs?: number;
}

interface LinkState {
  link: Link;
  participantId?: string;
  name?: string;
  tokens: number;
  refilledAt: number;
  helloTimer?: ReturnType<typeof setTimeout>;
}

const BUCKET_SIZE = 20;
const REFILL_PER_SECOND = 5;

/**
 * The host side of a live session. It owns no transport: anything that produces a {@link Link}
 * (WebRTC, an in-memory pipe in tests) hands it to {@link LiveShareHost.accept}.
 */
export class LiveShareHost {
  private readonly project: HostedProject;
  private readonly role: LiveRole;
  private readonly maxLinks: number;
  private readonly helloTimeoutMs: number;

  private links = new Set<LinkState>();
  private current: ProjectSnapshot | null = null;
  private rev = 0;
  private status: LiveHostState["status"] = "starting";
  private unwatch: Unsubscribe | null = null;
  private writes: Promise<void> = Promise.resolve();
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: LiveHostState) => void>();
  private joinedAt = new Map<string, string>();

  constructor(opts: LiveShareHostOptions) {
    this.project = opts.project;
    this.role = opts.role ?? "contribute";
    this.maxLinks = opts.maxLinks ?? 64;
    this.helloTimeoutMs = opts.helloTimeoutMs ?? 10_000;
  }

  /** Loads the project; throws if the store cannot open it (e.g. it is still locked). */
  async start(): Promise<void> {
    this.current = await this.project.snapshot();
    this.unwatch = this.project.watch((snapshot) => {
      this.current = snapshot;
      this.scheduleBroadcast();
    });
    this.status = "live";
    this.emit();
  }

  getState(): LiveHostState {
    const guests = new Map<string, LiveGuestInfo>();
    for (const s of this.links) {
      if (!s.participantId) continue;
      const existing = guests.get(s.participantId);
      if (existing) {
        existing.connections++;
      } else {
        guests.set(s.participantId, {
          participantId: s.participantId,
          name: s.name ?? "",
          connections: 1,
          joinedAt: this.joinedAt.get(s.participantId) ?? new Date().toISOString(),
        });
      }
    }
    return { status: this.status, guests: [...guests.values()] };
  }

  subscribe(cb: (state: LiveHostState) => void): Unsubscribe {
    this.listeners.add(cb);
    cb(this.getState());
    return () => {
      this.listeners.delete(cb);
    };
  }

  accept(link: Link): void {
    if (this.status !== "live") {
      link.close("session not live");
      return;
    }
    if (this.links.size >= this.maxLinks) {
      send(link, { t: "error", code: "session_full", message: "This session is full." });
      link.close("session full");
      return;
    }
    const state: LinkState = { link, tokens: BUCKET_SIZE, refilledAt: Date.now() };
    this.links.add(state);
    state.helloTimer = setTimeout(() => {
      if (!state.participantId) link.close("no hello");
    }, this.helloTimeoutMs);

    link.onMessage((raw) => this.onMessage(state, raw));
    link.onClose(() => {
      clearTimeout(state.helloTimer);
      this.links.delete(state);
      if (state.participantId) this.emit();
    });
  }

  close(reason = "The host ended the session."): void {
    if (this.status === "closed") return;
    this.status = "closed";
    this.unwatch?.();
    this.unwatch = null;
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    for (const s of [...this.links]) {
      clearTimeout(s.helloTimer);
      send(s.link, { t: "closing", reason });
      s.link.close("host closed");
    }
    this.links.clear();
    this.emit();
    this.listeners.clear();
  }

  private onMessage(state: LinkState, raw: unknown): void {
    if (this.status !== "live") return;
    const parsed = GuestMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const loose = raw as { t?: unknown; id?: unknown } | null;
      if (loose?.t === "submit" && typeof loose.id === "string") {
        this.ack(state, loose.id, "invalid", "The submission was not understood.");
      }
      return;
    }
    const msg = parsed.data;

    if (msg.t === "hello") {
      if (state.participantId) return;
      if (msg.proto !== PROTOCOL_VERSION) {
        send(state.link, {
          t: "error",
          code: "protocol_mismatch",
          message: "The host is running a different version of Deci. Reload both pages.",
        });
        state.link.close("protocol mismatch");
        return;
      }
      clearTimeout(state.helloTimer);
      const participantId = participantIdFromKey(msg.key);
      state.participantId = participantId;
      state.name = msg.name.trim();
      if (!this.joinedAt.has(participantId)) {
        this.joinedAt.set(participantId, new Date().toISOString());
      }
      send(state.link, {
        t: "welcome",
        proto: PROTOCOL_VERSION,
        participantId,
        name: state.name,
        role: this.role,
        rev: this.rev,
        snapshot: this.viewFor(participantId),
      });
      this.emit();
      return;
    }

    if (msg.t === "bye") {
      state.link.close("guest left");
      return;
    }

    // submit
    const { participantId, name } = state;
    if (!participantId || !name) return;
    if (!this.takeToken(state)) {
      this.ack(state, msg.id, "rate_limited", "Too many changes at once. Try again shortly.");
      return;
    }
    this.writes = this.writes.then(async () => {
      if (this.status !== "live" || !this.current) return;
      // Checked inside the queue, against the state every earlier write left behind.
      const check = checkSubmission(this.current, participantId, this.role, msg.entries);
      if (!check.ok) {
        this.ack(state, msg.id, check.code, check.message);
        return;
      }
      try {
        await this.project.appendFor({ participantId, displayName: name }, check.entries);
        this.current = await this.project.snapshot();
      } catch (err) {
        this.ack(
          state,
          msg.id,
          "store_failed",
          err instanceof Error ? err.message : "The host could not save this change."
        );
        return;
      }
      this.ack(state, msg.id);
      this.scheduleBroadcast();
    });
  }

  private ack(state: LinkState, id: string, code?: AckErrorCode, message?: string): void {
    send(
      state.link,
      code ? { t: "ack", id, ok: false, code, message } : { t: "ack", id, ok: true }
    );
  }

  private takeToken(state: LinkState): boolean {
    const now = Date.now();
    state.tokens = Math.min(
      BUCKET_SIZE,
      state.tokens + ((now - state.refilledAt) / 1000) * REFILL_PER_SECOND
    );
    state.refilledAt = now;
    if (state.tokens < 1) return false;
    state.tokens -= 1;
    return true;
  }

  private viewFor(participantId: string): Record<string, unknown> {
    if (!this.current) return {};
    return redactSnapshotFor(this.current, participantId, this.role) as unknown as Record<
      string,
      unknown
    >;
  }

  /** Coalesces bursts of store notifications into one update per guest. */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer || this.status !== "live") return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.rev++;
      for (const s of this.links) {
        if (!s.participantId) continue;
        send(s.link, { t: "snapshot", rev: this.rev, snapshot: this.viewFor(s.participantId) });
      }
    }, 30);
  }

  private emit(): void {
    const state = this.getState();
    for (const cb of this.listeners) cb(state);
  }
}

function send(link: Link, message: HostMessage): void {
  link.send(message);
}
