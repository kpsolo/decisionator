import type {
  IdeaSourcePlugin,
  PluginOAuthTokenResult,
  PluginRpcErrorDetails,
  PluginRpcMessage,
  PluginRpcRequest,
  PluginRpcResponse,
  ProjectSnapshot,
  Rng,
  StrategyInput,
  StrategyPlugin,
  StrategyResult,
} from "@decisionator/plugin-sdk";
import semver from "semver";
import {
  HOST_PLATFORM_VERSIONS,
  type HostPlatformVersions,
  ModuleError,
  validateManifest,
} from "../module-host.js";
import { FrameManager } from "./frame-manager.js";
import { InMemoryRpcEndpoint } from "./rpc-transport.js";
import type {
  CapabilityBridge,
  PluginLifecycleState,
  PluginManifest,
  RpcEndpoint,
  SandboxInstanceOptions,
  SandboxPluginStatus,
} from "./types.js";

export class SandboxError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly code: string,
    message: string,
    public readonly data?: unknown
  ) {
    super(`[Plugin ${pluginId}] ${message}`);
    this.name = "SandboxError";
  }
}

export class SandboxPluginInstance {
  private state: PluginLifecycleState = "uninitialized";
  private consecutiveErrors = 0;
  private lastError?: string;
  private reqIdCounter = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (err: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private unsubscribeMessage?: () => void;
  private frameManager?: FrameManager;
  private endpoint: RpcEndpoint;

  public readonly manifest: PluginManifest;
  public readonly grantedPermissions: Set<string>;
  public readonly settings: Record<string, unknown>;
  public readonly capabilities: CapabilityBridge;
  public readonly timeoutMs: number;
  public readonly strategyTimeoutMs: number;
  public readonly maxConsecutiveErrors: number;

  constructor(options: SandboxInstanceOptions) {
    this.manifest = options.manifest;
    this.grantedPermissions = new Set(options.grantedPermissions);
    this.settings = options.settings ?? {};
    this.capabilities = options.capabilities;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.strategyTimeoutMs = options.strategyTimeoutMs ?? 2000;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3;

    if (options.transport) {
      this.endpoint = options.transport;
    } else {
      // Create iframe endpoint
      this.frameManager = new FrameManager({
        manifest: this.manifest,
        grantedPermissions: options.grantedPermissions,
        bundleCode: "",
      });
      const { endpoint } = this.frameManager.createFrame();
      this.endpoint = endpoint;
    }

    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    this.unsubscribeMessage = this.endpoint.onMessage((msg: PluginRpcMessage) => {
      this.handleIncomingMessage(msg);
    });
  }

  private async handleIncomingMessage(msg: PluginRpcMessage): Promise<void> {
    if (msg.kind === "result" || msg.kind === "error") {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.kind === "result") {
          this.consecutiveErrors = 0;
          pending.resolve(msg.result);
        } else {
          this.recordError(msg.error.message);
          pending.reject(
            new SandboxError(this.manifest.id, msg.error.code, msg.error.message, msg.error.data)
          );
        }
      }
      return;
    }

    if (msg.kind === "event") {
      if (msg.name === "ctx.log") {
        const payload = msg.payload as { level: "debug" | "info" | "warn" | "error"; msg: string };
        this.capabilities.onLog?.(payload.level, payload.msg, this.manifest.id);
      } else if (msg.name === "ctx.ui.resize") {
        const payload = msg.payload as { height: number };
        this.capabilities.onResize?.(payload.height, this.manifest.id);
      } else if (msg.name === "ctx.ui.notify") {
        const payload = msg.payload as {
          msg: string;
          level?: "info" | "success" | "warn" | "error";
        };
        this.capabilities.onNotify?.(payload.msg, payload.level, this.manifest.id);
      } else if (msg.name === "plugin.loadError") {
        const payload = msg.payload as { message: string };
        this.recordError(payload.message);
      }
      return;
    }

    if (msg.kind === "call") {
      // Capability invocation from plugin to host
      await this.handlePluginCapabilityCall(msg);
    }
  }

  private async handlePluginCapabilityCall(msg: PluginRpcRequest): Promise<void> {
    const { id, method, params } = msg;

    try {
      if (method === "ctx.oauth.getToken") {
        const typedParams = params as { provider: string; opts?: { interactive?: boolean } };
        const requiredPerm = `oauth:${typedParams.provider}`;
        if (!this.grantedPermissions.has(requiredPerm)) {
          this.sendRpc({
            v: 1,
            id,
            kind: "error",
            error: {
              code: "PERMISSION_DENIED",
              message: `Plugin ${this.manifest.name} was not granted permission "${requiredPerm}"`,
            },
          });
          return;
        }

        const tokenResult = await this.capabilities.getOAuthToken(
          typedParams.provider,
          typedParams.opts
        );
        this.sendRpc({ v: 1, id, kind: "result", result: tokenResult });
        return;
      }

      if (method === "ctx.project.get") {
        if (!this.grantedPermissions.has("project:read")) {
          this.sendRpc({
            v: 1,
            id,
            kind: "error",
            error: {
              code: "PERMISSION_DENIED",
              message: `Plugin ${this.manifest.name} was not granted permission "project:read"`,
            },
          });
          return;
        }

        const projectSnapshot = await this.capabilities.getProjectSnapshot();
        this.sendRpc({ v: 1, id, kind: "result", result: projectSnapshot });
        return;
      }

      if (method === "ctx.clipboard.getText") {
        if (!this.grantedPermissions.has("clipboard:read")) {
          this.sendRpc({
            v: 1,
            id,
            kind: "error",
            error: {
              code: "PERMISSION_DENIED",
              message: `Plugin ${this.manifest.name} was not granted permission "clipboard:read"`,
            },
          });
          return;
        }

        const text = this.capabilities.getClipboardText
          ? await this.capabilities.getClipboardText()
          : "";
        this.sendRpc({ v: 1, id, kind: "result", result: text });
        return;
      }

      this.sendRpc({
        v: 1,
        id,
        kind: "error",
        error: { code: "NOT_SUPPORTED", message: `Unknown host method ${method}` },
      });
    } catch (err) {
      this.sendRpc({
        v: 1,
        id,
        kind: "error",
        error: {
          code: "PLUGIN_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private sendRpc(message: PluginRpcMessage): void {
    this.endpoint.postMessage(message);
  }

  public async callPlugin<T>(
    method: string,
    params: unknown,
    customTimeoutMs?: number
  ): Promise<T> {
    if (this.state === "crashed") {
      throw new SandboxError(
        this.manifest.id,
        "PLUGIN_CRASHED",
        `${this.manifest.name} stopped responding`
      );
    }
    if (this.state === "disposed") {
      throw new SandboxError(
        this.manifest.id,
        "PLUGIN_DISPOSED",
        `${this.manifest.name} has been disposed`
      );
    }

    const timeoutLimit =
      customTimeoutMs ?? (method === "strategy.decide" ? this.strategyTimeoutMs : this.timeoutMs);

    const id = `host_req_${++this.reqIdCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const timeoutMsg = `${this.manifest.name} stopped responding`;
        this.recordError(timeoutMsg, true);
        reject(new SandboxError(this.manifest.id, "TIMEOUT", timeoutMsg));
      }, timeoutLimit);

      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      this.sendRpc({
        v: 1,
        id,
        kind: "call",
        method,
        params,
      });
    });
  }

  private recordError(message: string, isFatalTimeout = false): void {
    this.consecutiveErrors++;
    this.lastError = message;

    if (isFatalTimeout || this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.teardown(
        isFatalTimeout ? message : `${this.manifest.name} stopped responding (3 consecutive errors)`
      );
    }
  }

  private teardown(reason: string): void {
    this.state = "crashed";
    this.lastError = reason;

    // Reject all pending calls
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new SandboxError(this.manifest.id, "TIMEOUT", reason));
    }
    this.pendingRequests.clear();

    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = undefined;
    }

    if (this.endpoint) {
      this.endpoint.destroy();
    }

    if (this.frameManager) {
      this.frameManager.destroy();
      this.frameManager = undefined;
    }
  }

  public async init(platformVersion = "1.0.0", locale = "en"): Promise<void> {
    this.state = "initializing";
    await this.callPlugin("plugin.init", {
      settings: this.settings,
      grantedPermissions: Array.from(this.grantedPermissions),
      platformVersion,
      locale,
    });
    this.state = "ready";
    this.consecutiveErrors = 0;
  }

  public async settingsChanged(settings: Record<string, unknown>): Promise<void> {
    Object.assign(this.settings, settings);
    await this.callPlugin("plugin.settingsChanged", { settings: this.settings });
  }

  public async dispose(): Promise<void> {
    if (this.state === "ready" || this.state === "initializing") {
      try {
        await this.callPlugin("plugin.dispose", {}, 1000);
      } catch {
        // Ignore dispose errors
      }
    }
    this.teardown("Plugin disposed");
    this.state = "disposed";
  }

  public getStatus(): SandboxPluginStatus {
    return {
      id: this.manifest.id,
      state: this.state,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  public createStrategyProxy(): {
    check: (input: StrategyInput) => { ok: true } | { ok: false; reason: string };
    decide: (input: StrategyInput, rng: Rng) => Promise<StrategyResult>;
  } {
    return {
      check: (_input: StrategyInput): { ok: true } | { ok: false; reason: string } => {
        return { ok: true };
      },
      decide: async (input: StrategyInput, rng: Rng) => {
        return this.callPlugin<StrategyResult>(
          "strategy.decide",
          { input, rng },
          this.strategyTimeoutMs
        );
      },
    };
  }

  public createIdeaSourceProxy(): IdeaSourcePlugin {
    return {
      fetch: async (req) => {
        return this.callPlugin("ideaSource.fetch", { req }, this.timeoutMs);
      },
    };
  }
}

/**
 * Sandbox Host: manages sandboxed plugins with isolation, permission review and lifecycle tracking.
 */
export class SandboxHost {
  private instances = new Map<string, SandboxPluginInstance>();

  constructor(private hostVersions: HostPlatformVersions = HOST_PLATFORM_VERSIONS) {}

  /**
   * Validates manifest and compatibility before instantiating.
   */
  public validate(rawManifest: unknown): PluginManifest {
    const manifest = validateManifest(rawManifest, this.hostVersions);

    // Validate platform runtime compatibility (Constitution §II, US6 Acceptance Scenario 4)
    for (const [key, range] of Object.entries(manifest.platform)) {
      const hostVersion = this.hostVersions[key as keyof HostPlatformVersions];
      if (!hostVersion) {
        throw new Error(
          `Module "${manifest.name}" requires platform "${key}" which is not supported by this host`
        );
      }
      if (!semver.satisfies(hostVersion, range)) {
        throw new Error(`Built for Deci runtime ${range}, this app provides ${hostVersion}`);
      }
    }

    return manifest;
  }

  public createInstance(options: SandboxInstanceOptions): SandboxPluginInstance {
    this.validate(options.manifest);
    const instance = new SandboxPluginInstance(options);
    this.instances.set(options.manifest.id, instance);
    return instance;
  }

  public getInstance(id: string): SandboxPluginInstance | undefined {
    return this.instances.get(id);
  }

  public removeInstance(id: string): void {
    const inst = this.instances.get(id);
    if (inst) {
      inst.dispose();
      this.instances.delete(id);
    }
  }

  public listStatuses(): SandboxPluginStatus[] {
    return Array.from(this.instances.values()).map((inst) => inst.getStatus());
  }
}
