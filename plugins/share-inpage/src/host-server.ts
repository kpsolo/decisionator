import type { Entry, ProjectRef, ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import { type InPageMessage, parseInPageMessage } from "./protocol.js";

export interface HostServerOptions {
  sessionId: string;
  projectRef: ProjectRef;
  store: ProjectStore;
  onPeerCountChange?: (count: number) => void;
}

export class InPageHostServer {
  readonly sessionId: string;
  private projectRef: ProjectRef;
  private store: ProjectStore;
  private activePeers = new Set<string>();
  private broadcastChannel: BroadcastChannel | null = null;
  private unsubStoreWatch: (() => void) | null = null;
  private onPeerCountChange?: (count: number) => void;

  constructor(opts: HostServerOptions) {
    this.sessionId = opts.sessionId;
    this.projectRef = opts.projectRef;
    this.store = opts.store;
    this.onPeerCountChange = opts.onPeerCountChange;

    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(`deci_inpage_${this.sessionId}`);
      this.broadcastChannel.onmessage = (event) => {
        this.handleIncomingMessage(event.data);
      };
    }

    // Watch project updates to broadcast to peers
    this.unsubStoreWatch = this.store.watch(this.projectRef, (newSnapshot) => {
      this.broadcast({
        type: "HOST_SNAPSHOT_UPDATE",
        sessionId: this.sessionId,
        snapshot: newSnapshot as unknown as Record<string, unknown>,
      });
    });
  }

  getConnectedPeerCount(): number {
    return this.activePeers.size;
  }

  private broadcast(msg: InPageMessage): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(msg);
    }
  }

  private async handleIncomingMessage(raw: unknown): Promise<void> {
    try {
      const msg = parseInPageMessage(raw);

      if (msg.type === "PEER_HELLO") {
        this.activePeers.add(msg.participantId);
        this.onPeerCountChange?.(this.activePeers.size);

        // Send current snapshot
        const snapshot = await this.store.openProject(this.projectRef);
        this.broadcast({
          type: "HOST_WELCOME",
          sessionId: this.sessionId,
          projectTitle: snapshot.project.title,
          snapshot: snapshot as unknown as Record<string, unknown>,
          role: "contribute",
        });
      } else if (msg.type === "PEER_APPEND") {
        // Append entries to store
        await this.store.append(this.projectRef, msg.entries as unknown as Entry[]);
        // The watch callback will broadcast the updated snapshot
      }
    } catch {
      // Discard invalid incoming peer packet
    }
  }

  close(reason = "Host closed session"): void {
    this.broadcast({
      type: "HOST_CLOSING",
      sessionId: this.sessionId,
      reason,
    });

    if (this.unsubStoreWatch) {
      this.unsubStoreWatch();
      this.unsubStoreWatch = null;
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.activePeers.clear();
  }
}
