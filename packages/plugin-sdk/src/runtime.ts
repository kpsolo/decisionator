import type { IdeaSourcePlugin } from "./idea-source.js";
import type {
  ExposureContext,
  OptionListContext,
  OptionListContribution,
  OptionViewContext,
  OptionViewContribution,
} from "./option-view.js";
import type { ProjectSnapshot } from "./project-store.js";
import type { Rng, StrategyPlugin } from "./strategy.js";

export type PluginRpcVersion = 1;

export interface PluginRpcRequest {
  v: PluginRpcVersion;
  id: string;
  kind: "call";
  method: string;
  params: unknown;
}

export interface PluginRpcSuccessResponse {
  v: PluginRpcVersion;
  id: string;
  kind: "result";
  result: unknown;
}

export interface PluginRpcErrorDetails {
  code:
    | "PERMISSION_DENIED"
    | "TIMEOUT"
    | "INVALID_PARAMS"
    | "PRECONDITION_FAILED"
    | "NOT_SUPPORTED"
    | "DeterminismError"
    | "PLUGIN_ERROR"
    | string;
  message: string;
  data?: unknown;
}

export interface PluginRpcErrorResponse {
  v: PluginRpcVersion;
  id: string;
  kind: "error";
  error: PluginRpcErrorDetails;
}

export type PluginRpcResponse = PluginRpcSuccessResponse | PluginRpcErrorResponse;

export interface PluginRpcEvent {
  v: PluginRpcVersion;
  kind: "event";
  name: string;
  payload: unknown;
}

export type PluginRpcMessage = PluginRpcRequest | PluginRpcResponse | PluginRpcEvent;

export class DeterminismError extends Error {
  public readonly code = "DeterminismError";
  constructor(
    message = "Math.random() and crypto.getRandomValues() are forbidden in strategies. Use ctx.rng."
  ) {
    super(message);
    this.name = "DeterminismError";
  }
}

export interface PluginOAuthTokenResult {
  accessToken: string;
  expiresAt: string;
  callbackParams?: Record<string, string>;
}

export interface PluginContext {
  oauth: {
    getToken(provider: string, opts?: { interactive?: boolean }): Promise<PluginOAuthTokenResult>;
  };
  project: {
    get(): Promise<ProjectSnapshot>;
  };
  log(level: "debug" | "info" | "warn" | "error", msg: string): void;
  ui: {
    resize(height: number): void;
    notify(msg: string, level?: "info" | "success" | "warn" | "error"): void;
  };
  rng?: Rng;
}

export interface PluginInitParams {
  settings: unknown;
  grantedPermissions: string[];
  platformVersion: string;
  locale: string;
}

export interface PluginDefinition {
  init?(ctx: PluginContext, params: PluginInitParams): Promise<{ ok: boolean }> | { ok: boolean };
  settingsChanged?(settings: unknown): void | Promise<void>;
  dispose?(): void | Promise<void>;
  strategy?: StrategyPlugin;
  ideaSource?: IdeaSourcePlugin;
  /** Option view extension (contract `option-view` 1.0.0): what this plugin adds to an option. */
  optionView?(ctx: OptionViewContext): OptionViewContribution | Promise<OptionViewContribution>;
  /** Summary and filters for the option list. */
  optionList?(ctx: OptionListContext): OptionListContribution | Promise<OptionListContribution>;
  /** Called when the viewer presses one of this plugin's footer actions. */
  onOptionAction?(ctx: OptionViewContext, actionId: string): void | Promise<void>;
  /** Called after the viewer confirmed one of this plugin's option list actions. */
  onListAction?(ctx: OptionListContext, actionId: string): void | Promise<void>;
  /** How long an option must stay on screen before `onOptionExposed`; `null` turns it off. */
  exposureMs?(settings: Record<string, unknown>): number | null;
  /** Options that stayed on screen for `exposureMs`, reported once per page visit. */
  onOptionExposed?(ctx: ExposureContext, optionIds: string[]): void | Promise<void>;
}

/**
 * Global reference to the registered plugin definition inside a plugin iframe.
 */
let registeredPluginDefinition: PluginDefinition | null = null;

export function definePlugin(def: PluginDefinition): void {
  if (registeredPluginDefinition) {
    throw new Error("definePlugin() can only be called once per plugin execution environment.");
  }
  registeredPluginDefinition = def;
}

export function getRegisteredPluginDefinition(): PluginDefinition | null {
  return registeredPluginDefinition;
}

export function resetRegisteredPluginDefinition(): void {
  registeredPluginDefinition = null;
}
