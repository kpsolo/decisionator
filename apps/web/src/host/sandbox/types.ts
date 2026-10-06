import type { Contribution, Option, Project } from "@decisionator/core";
import type {
  PluginOAuthTokenResult,
  PluginRpcErrorDetails,
  PluginRpcMessage,
  PluginRpcRequest,
  PluginRpcResponse,
  ProjectSnapshot,
} from "@decisionator/plugin-sdk";
import type { PluginManifest } from "../module-host.js";

export type { PluginManifest };

export interface CapabilityBridge {
  getOAuthToken: (
    provider: string,
    opts?: { interactive?: boolean }
  ) => Promise<PluginOAuthTokenResult>;
  getProjectSnapshot: () => Promise<ProjectSnapshot>;
  getClipboardText?: () => Promise<string>;
  onLog?: (level: "debug" | "info" | "warn" | "error", msg: string, pluginId: string) => void;
  onResize?: (height: number, pluginId: string) => void;
  onNotify?: (
    msg: string,
    level: "info" | "success" | "warn" | "error" | undefined,
    pluginId: string
  ) => void;
}

export interface SandboxInstanceOptions {
  manifest: PluginManifest;
  grantedPermissions: string[];
  settings?: Record<string, unknown>;
  locale?: string;
  capabilities: CapabilityBridge;
  transport?: RpcEndpoint;
  timeoutMs?: number;
  strategyTimeoutMs?: number;
  maxConsecutiveErrors?: number;
}

export interface RpcEndpoint {
  postMessage: (message: PluginRpcMessage) => void;
  onMessage: (handler: (message: PluginRpcMessage) => void) => () => void;
  destroy: () => void;
}

export type PluginLifecycleState =
  | "uninitialized"
  | "initializing"
  | "ready"
  | "crashed"
  | "disposed";

export interface SandboxPluginStatus {
  id: string;
  state: PluginLifecycleState;
  lastError?: string;
  consecutiveErrors: number;
}
