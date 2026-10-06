import type { Entry, ProjectSnapshot } from "@decisionator/plugin-sdk";
import { type InPageMessage, parseInPageMessage } from "./protocol.js";

export interface PeerClientOptions {
  sessionId: string;
  participantId: string;
  displayName: string;
  onSnapshot?: (snapshot: ProjectSnapshot) => void;
  onClosed?: (reason: string) => void;
}

export class InPagePeerClient {
  readonly sessionId: string;
  readonly participantId: string;
  readonly displayName: string;

  private broadcastChannel: BroadcastChannel | null = null;
  private currentSnapshot: ProjectSnapshot | null = null;
  private onSnapshotCallback?: (snapshot: ProjectSnapshot) => void;
  private onClosedCallback?: (reason: string) => void;

  constructor(opts: PeerClientOptions) {
    this.sessionId = opts.sessionId;
    this.participantId = opts.participantId;
    this.displayName = opts.displayName;
    this.onSnapshotCallback = opts.onSnapshot;
    this.onClosedCallback = opts.onClosed;

    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(`deci_inpage_${this.sessionId}`);
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncoming(event.data);
      };
    }
  }

  connect(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: "PEER_HELLO",
        sessionId: this.sessionId,
        participantId: this.participantId,
        displayName: this.displayName,
      });
    }
  }

  getSnapshot(): ProjectSnapshot | null {
    return this.currentSnapshot;
  }

  submitEntries(entries: Entry[]): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: "PEER_APPEND",
        sessionId: this.sessionId,
        participantId: this.participantId,
        entries,
      });
    }
  }

  private handleIncoming(raw: unknown): void {
    try {
      const msg = parseInPageMessage(raw);

      if (msg.type === "HOST_WELCOME" || msg.type === "HOST_SNAPSHOT_UPDATE") {
        this.currentSnapshot = msg.snapshot as unknown as ProjectSnapshot;
        this.onSnapshotCallback?.(this.currentSnapshot);
      } else if (msg.type === "HOST_CLOSING") {
        this.onClosedCallback?.(msg.reason);
      }
    } catch {
      // Ignore invalid packet
    }
  }

  disconnect(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }
}
