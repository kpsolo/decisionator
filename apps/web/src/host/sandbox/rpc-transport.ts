import type { PluginRpcMessage } from "@decisionator/plugin-sdk";
import type { RpcEndpoint } from "./types.js";

/**
 * In-memory RPC endpoint for fast, reliable unit testing without full browser iframes.
 */
export class InMemoryRpcEndpoint implements RpcEndpoint {
  private peer?: InMemoryRpcEndpoint;
  private handlers = new Set<(message: PluginRpcMessage) => void>();
  private isDestroyed = false;

  setPeer(peer: InMemoryRpcEndpoint): void {
    this.peer = peer;
  }

  postMessage(message: PluginRpcMessage): void {
    if (this.isDestroyed || !this.peer || this.peer.isDestroyed) {
      return;
    }
    // Simulate async dispatch (like postMessage event loop)
    queueMicrotask(() => {
      if (this.peer && !this.peer.isDestroyed) {
        // Structured clone simulation
        const cloned = structuredClone(message);
        for (const handler of this.peer.handlers) {
          handler(cloned);
        }
      }
    });
  }

  onMessage(handler: (message: PluginRpcMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  destroy(): void {
    this.isDestroyed = true;
    this.handlers.clear();
    this.peer = undefined;
  }
}

export function createLinkedRpcPair(): [
  hostEndpoint: InMemoryRpcEndpoint,
  pluginEndpoint: InMemoryRpcEndpoint,
] {
  const host = new InMemoryRpcEndpoint();
  const plugin = new InMemoryRpcEndpoint();
  host.setPeer(plugin);
  plugin.setPeer(host);
  return [host, plugin];
}

/**
 * Real browser iframe RPC endpoint using window.postMessage.
 */
export class IframeRpcEndpoint implements RpcEndpoint {
  private handlers = new Set<(message: PluginRpcMessage) => void>();
  private listener: (event: MessageEvent) => void;
  private isDestroyed = false;

  constructor(
    private iframe: HTMLIFrameElement,
    private targetWindow: Window | null = null
  ) {
    this.listener = (event: MessageEvent) => {
      if (this.isDestroyed) return;
      // In sandboxed srcdoc iframes without allow-same-origin, origin is "null"
      if (this.iframe.contentWindow && event.source === this.iframe.contentWindow) {
        const data = event.data as PluginRpcMessage;
        if (data && typeof data === "object" && "v" in data && data.v === 1) {
          for (const handler of this.handlers) {
            handler(data);
          }
        }
      }
    };

    window.addEventListener("message", this.listener);
  }

  postMessage(message: PluginRpcMessage): void {
    if (this.isDestroyed) return;
    const target = this.targetWindow ?? this.iframe.contentWindow;
    if (target) {
      // Sandboxed srcdoc frames have origin 'null', so targetOrigin must be '*'
      target.postMessage(message, "*");
    }
  }

  onMessage(handler: (message: PluginRpcMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  destroy(): void {
    this.isDestroyed = true;
    this.handlers.clear();
    window.removeEventListener("message", this.listener);
  }
}
