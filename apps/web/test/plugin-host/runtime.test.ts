import type {
  Contribution,
  Option,
  PluginOAuthTokenResult,
  PluginRpcMessage,
  PluginRpcRequest,
  Project,
  ProjectSnapshot,
} from "@decisionator/plugin-sdk";
import { DeterminismError } from "@decisionator/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import strategyBordaManifest from "../../../../plugins/strategy-borda/decisionator-plugin.json";
import {
  InMemoryRpcEndpoint,
  SandboxError,
  SandboxHost,
  type SandboxHostCapabilities,
  SandboxPluginInstance,
  createLinkedRpcPair,
} from "../../src/host/sandbox/index.js";

const sampleProject: Project = {
  id: "proj_123",
  title: "Dinner Decision",
  owner: "alice@example.com",
  storage: { type: "google-sheets", fileId: "sheet_123" },
  access: { type: "link", level: "contribute" },
  isPasswordProtected: false,
  voting: { topN: 3, liveResults: true, isOpen: true },
};

const sampleOptions: Option[] = [
  { id: "opt_1", title: "Sushi", status: "active", createdBy: "alice@example.com" },
  { id: "opt_2", title: "Pizza", status: "active", createdBy: "bob@example.com" },
];

const sampleContributions: Contribution[] = [
  {
    id: "cnt_1",
    at: new Date().toISOString(),
    by: "agent:researcher for alice@example.com",
    targetKind: "option",
    targetId: "opt_1",
    payload: {
      type: "note",
      body: "High ratings on Yelp",
      sources: [{ url: "https://yelp.com/biz/sushi" }],
      reviewStatus: "pending",
    },
  },
];

function createMockCapabilities(): {
  capabilities: SandboxHostCapabilities;
  getOAuthToken: ReturnType<typeof vi.fn>;
  getProjectSnapshot: ReturnType<typeof vi.fn>;
  onLog: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  onNotify: ReturnType<typeof vi.fn>;
  getClipboardText: ReturnType<typeof vi.fn>;
} {
  const getOAuthToken = vi.fn().mockResolvedValue({
    accessToken: "mock_token_12345",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    callbackParams: { picked_file_ids: "doc_abc" },
  } satisfies PluginOAuthTokenResult);

  const getProjectSnapshot = vi.fn().mockResolvedValue({
    project: sampleProject,
    options: sampleOptions,
    contributions: sampleContributions,
  } satisfies ProjectSnapshot);

  const onLog = vi.fn();
  const onResize = vi.fn();
  const onNotify = vi.fn();
  const getClipboardText = vi.fn().mockResolvedValue("Copied test text");

  return {
    capabilities: {
      getOAuthToken,
      getProjectSnapshot,
      onLog,
      onResize,
      onNotify,
      getClipboardText,
    },
    getOAuthToken,
    getProjectSnapshot,
    onLog,
    onResize,
    onNotify,
    getClipboardText,
  };
}

describe("Plugin Runtime Contract & Sandbox Host (FR-050, FR-052)", () => {
  describe("RPC Envelope & Bidirectional Communication", () => {
    it("conforms to contracts/plugin-runtime.md RPC envelope structure", async () => {
      const [hostEndpoint, pluginEndpoint] = createLinkedRpcPair();
      const { capabilities } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: ["project:read"],
        capabilities,
        transport: hostEndpoint,
      });

      // Simulate plugin answering plugin.init
      pluginEndpoint.onMessage((msg: PluginRpcMessage) => {
        if (msg.kind === "call" && msg.method === "plugin.init") {
          expect(msg.v).toBe(1);
          expect(msg.kind).toBe("call");
          expect(typeof msg.id).toBe("string");
          expect(msg.params).toEqual({
            settings: {},
            grantedPermissions: ["project:read"],
            platformVersion: "1.0.0",
            locale: "en",
          });

          // Respond with success
          pluginEndpoint.postMessage({
            v: 1,
            id: msg.id,
            kind: "result",
            result: { ok: true },
          });
        }
      });

      await instance.init("1.0.0", "en");
      expect(instance.getStatus().state).toBe("ready");
    });

    it("handles host capability calls from plugin (ctx.project.get)", async () => {
      const [hostEndpoint, pluginEndpoint] = createLinkedRpcPair();
      const { capabilities, getProjectSnapshot } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: ["project:read"],
        capabilities,
        transport: hostEndpoint,
      });

      let receivedSnapshot: ProjectSnapshot | undefined;

      pluginEndpoint.onMessage((msg: PluginRpcMessage) => {
        if (msg.kind === "result" && msg.id === "call_project_get") {
          receivedSnapshot = msg.result as ProjectSnapshot;
        }
      });

      // Plugin asks for project snapshot
      pluginEndpoint.postMessage({
        v: 1,
        id: "call_project_get",
        kind: "call",
        method: "ctx.project.get",
        params: {},
      });

      // Allow microtask to process
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(getProjectSnapshot).toHaveBeenCalledTimes(1);
      expect(receivedSnapshot?.project.id).toBe("proj_123");
      expect(receivedSnapshot?.options.length).toBe(2);
    });
  });

  describe("Permission Enforcement (PERMISSION_DENIED)", () => {
    it("returns PERMISSION_DENIED when oauth permission is missing", async () => {
      const [hostEndpoint, pluginEndpoint] = createLinkedRpcPair();
      const { capabilities, getOAuthToken } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: [], // No oauth permissions granted
        capabilities,
        transport: hostEndpoint,
      });

      let errorReceived: { code: string; message: string } | undefined;

      pluginEndpoint.onMessage((msg: PluginRpcMessage) => {
        if (msg.kind === "error" && msg.id === "oauth_req_1") {
          errorReceived = msg.error;
        }
      });

      pluginEndpoint.postMessage({
        v: 1,
        id: "oauth_req_1",
        kind: "call",
        method: "ctx.oauth.getToken",
        params: { provider: "google-drive" },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(getOAuthToken).not.toHaveBeenCalled();
      expect(errorReceived).toBeDefined();
      expect(errorReceived?.code).toBe("PERMISSION_DENIED");
      expect(errorReceived?.message).toContain('not granted permission "oauth:google-drive"');
    });

    it("allows oauth call when oauth:<provider> permission is granted", async () => {
      const [hostEndpoint, pluginEndpoint] = createLinkedRpcPair();
      const { capabilities, getOAuthToken } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: ["oauth:google-drive"],
        capabilities,
        transport: hostEndpoint,
      });

      let tokenResult: PluginOAuthTokenResult | undefined;

      pluginEndpoint.onMessage((msg: PluginRpcMessage) => {
        if (msg.kind === "result" && msg.id === "oauth_req_2") {
          tokenResult = msg.result as PluginOAuthTokenResult;
        }
      });

      pluginEndpoint.postMessage({
        v: 1,
        id: "oauth_req_2",
        kind: "call",
        method: "ctx.oauth.getToken",
        params: { provider: "google-drive", opts: { interactive: true } },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(getOAuthToken).toHaveBeenCalledWith("google-drive", { interactive: true });
      expect(tokenResult?.accessToken).toBe("mock_token_12345");
    });

    it("returns PERMISSION_DENIED when clipboard:read is not granted", async () => {
      const [hostEndpoint, pluginEndpoint] = createLinkedRpcPair();
      const { capabilities, getClipboardText } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: [],
        capabilities,
        transport: hostEndpoint,
      });

      let errorReceived: { code: string; message: string } | undefined;

      pluginEndpoint.onMessage((msg: PluginRpcMessage) => {
        if (msg.kind === "error" && msg.id === "clip_req_1") {
          errorReceived = msg.error;
        }
      });

      pluginEndpoint.postMessage({
        v: 1,
        id: "clip_req_1",
        kind: "call",
        method: "ctx.clipboard.getText",
        params: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(getClipboardText).not.toHaveBeenCalled();
      expect(errorReceived?.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("Timeouts and Failure Teardown (FR-052)", () => {
    it("tears down plugin frame and sets state to crashed on timeout", async () => {
      const [hostEndpoint] = createLinkedRpcPair();
      const { capabilities } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: [],
        capabilities,
        transport: hostEndpoint,
        timeoutMs: 30, // 30ms timeout for fast testing
      });

      // Call plugin without plugin responding
      await expect(instance.callPlugin("plugin.init", {})).rejects.toThrow(
        /Borda count ranking strategy stopped responding/
      );

      const status = instance.getStatus();
      expect(status.state).toBe("crashed");
      expect(status.lastError).toContain("Borda count ranking strategy stopped responding");

      // Subsequent calls are rejected immediately
      await expect(instance.callPlugin("strategy.decide", {})).rejects.toThrow(
        /stopped responding/
      );
    });

    it("tears down plugin after 3 consecutive errors", async () => {
      const [hostEndpoint, pluginEndpoint] = createLinkedRpcPair();
      const { capabilities } = createMockCapabilities();

      const instance = new SandboxPluginInstance({
        manifest: strategyBordaManifest as unknown as PluginManifest,
        grantedPermissions: [],
        capabilities,
        transport: hostEndpoint,
        timeoutMs: 500,
        maxConsecutiveErrors: 3,
      });

      // Respond with errors
      pluginEndpoint.onMessage((msg: PluginRpcMessage) => {
        if (msg.kind === "call") {
          pluginEndpoint.postMessage({
            v: 1,
            id: msg.id,
            kind: "error",
            error: { code: "PLUGIN_ERROR", message: "Failure in calculation" },
          });
        }
      });

      // 1st error
      await expect(instance.callPlugin("do_step", {})).rejects.toThrow(/Failure in calculation/);
      expect(instance.getStatus().consecutiveErrors).toBe(1);
      expect(instance.getStatus().state).not.toBe("crashed");

      // 2nd error
      await expect(instance.callPlugin("do_step", {})).rejects.toThrow(/Failure in calculation/);
      expect(instance.getStatus().consecutiveErrors).toBe(2);
      expect(instance.getStatus().state).not.toBe("crashed");

      // 3rd error -> triggers teardown
      await expect(instance.callPlugin("do_step", {})).rejects.toThrow(/Failure in calculation/);
      expect(instance.getStatus().state).toBe("crashed");
      expect(instance.getStatus().lastError).toContain("stopped responding (3 consecutive errors)");
    });
  });

  describe("Incompatible Platform Version Refusal (FR-052)", () => {
    it("refuses incompatible runtime version with exact expected error message", () => {
      const host = new SandboxHost({
        runtime: "1.0.0",
        strategy: "1.1.0",
        ideaSource: "1.0.0",
        projectStore: "1.1.0",
        uiSlot: "1.0.0",
      });

      const manifestIncompatible = {
        ...strategyBordaManifest,
        platform: {
          runtime: "^2.0.0", // Host provides 1.0.0
        },
      };

      expect(() => host.validate(manifestIncompatible)).toThrow(
        "Built for Deci runtime ^2.0.0, this app provides 1.0.0"
      );
    });

    it("refuses plugin when required platform feature is missing from host", () => {
      const host = new SandboxHost({
        runtime: "1.0.0",
      });

      const manifestWithStrategy = {
        ...strategyBordaManifest,
        platform: {
          runtime: "^1.0.0",
          strategy: "^1.0.0",
        },
      };

      expect(() => host.validate(manifestWithStrategy)).toThrow(
        /requires platform "strategy" which is not supported by this host/
      );
    });
  });

  describe("Determinism Stubs for Strategies (FR-052, contracts/plugin-runtime.md)", () => {
    it("throws DeterminismError when Math.random or crypto.getRandomValues are invoked in strategy stubs", () => {
      // In plugin runtime, strategy stubs are injected:
      const stubMathRandom = () => {
        throw new DeterminismError();
      };
      const stubCryptoRandom = () => {
        throw new DeterminismError();
      };

      expect(() => stubMathRandom()).toThrow(DeterminismError);
      expect(() => stubMathRandom()).toThrow(
        /Math\.random\(\) and crypto\.getRandomValues\(\) are forbidden in strategies\. Use ctx\.rng\./
      );

      expect(() => stubCryptoRandom()).toThrow(DeterminismError);
    });
  });
});
