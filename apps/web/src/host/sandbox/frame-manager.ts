import { buildPluginCsp } from "./csp.js";
import { IframeRpcEndpoint } from "./rpc-transport.js";
import type { PluginManifest, RpcEndpoint } from "./types.js";

export interface FrameManagerOptions {
  container?: HTMLElement;
  grantedPermissions: string[];
  manifest: PluginManifest;
  bundleCode: string;
}

export class FrameManager {
  private iframe?: HTMLIFrameElement;
  private endpoint?: RpcEndpoint;

  constructor(private options: FrameManagerOptions) {}

  createFrame(): { iframe: HTMLIFrameElement; endpoint: RpcEndpoint } {
    const { grantedPermissions, manifest, bundleCode, container } = this.options;
    const { cspHeaderOrMeta } = buildPluginCsp(grantedPermissions);

    const iframe = document.createElement("iframe");
    // Standard sandboxing per R4: allow-scripts only (opaque origin 'null', no cookies, no storage, no parent access)
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    iframe.setAttribute("data-plugin-id", manifest.id);

    const isStrategy = Boolean(manifest.provides?.strategy);

    // Bootstrap script that sets up RPC inside the sandbox frame
    const srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${cspHeaderOrMeta}">
  <title>Plugin Frame: ${manifest.name}</title>
</head>
<body>
  <script>
    (function() {
      // Determinism stubs for strategies (FR-052, contracts/plugin-runtime.md)
      ${
        isStrategy
          ? `
      Math.random = function() {
        var err = new Error("Math.random() is forbidden in strategies. Use ctx.rng.");
        err.code = "DeterminismError";
        throw err;
      };
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues = function() {
          var err = new Error("crypto.getRandomValues() is forbidden in strategies. Use ctx.rng.");
          err.code = "DeterminismError";
          throw err;
        };
      }
      `
          : ""
      }

      var pluginDef = null;
      var pluginCtx = null;
      var pendingRequests = new Map();
      var reqCounter = 0;

      window.definePlugin = function(def) {
        if (pluginDef) throw new Error("definePlugin called more than once");
        pluginDef = def;
      };

      function sendRpc(msg) {
        window.parent.postMessage(msg, "*");
      }

      function callHost(method, params) {
        return new Promise(function(resolve, reject) {
          var id = "host_" + (++reqCounter) + "_" + Math.random().toString(36).slice(2);
          pendingRequests.set(id, { resolve: resolve, reject: reject });
          sendRpc({ v: 1, id: id, kind: "call", method: method, params: params });
        });
      }

      function createPluginContext() {
        return {
          oauth: {
            getToken: function(provider, opts) {
              return callHost("ctx.oauth.getToken", { provider: provider, opts: opts });
            }
          },
          project: {
            get: function() {
              return callHost("ctx.project.get", {});
            }
          },
          clipboard: {
            getText: function() {
              return callHost("ctx.clipboard.getText", {});
            }
          },
          log: function(level, msg) {
            sendRpc({ v: 1, kind: "event", name: "ctx.log", payload: { level: level, msg: msg } });
          },
          ui: {
            resize: function(height) {
              sendRpc({ v: 1, kind: "event", name: "ctx.ui.resize", payload: { height: height } });
            },
            notify: function(msg, level) {
              sendRpc({ v: 1, kind: "event", name: "ctx.ui.notify", payload: { msg: msg, level: level } });
            }
          }
        };
      }

      window.addEventListener("message", async function(event) {
        var data = event.data;
        if (!data || typeof data !== "object" || data.v !== 1) return;

        if (data.kind === "result" || data.kind === "error") {
          var pending = pendingRequests.get(data.id);
          if (pending) {
            pendingRequests.delete(data.id);
            if (data.kind === "result") {
              pending.resolve(data.result);
            } else {
              var err = new Error(data.error.message || "Host call failed");
              err.code = data.error.code;
              err.data = data.error.data;
              pending.reject(err);
            }
          }
          return;
        }

        if (data.kind === "call") {
          var id = data.id;
          try {
            if (data.method === "plugin.init") {
              pluginCtx = createPluginContext();
              var res = pluginDef && pluginDef.init ? await pluginDef.init(pluginCtx, data.params) : { ok: true };
              sendRpc({ v: 1, id: id, kind: "result", result: res || { ok: true } });
            } else if (data.method === "plugin.settingsChanged") {
              if (pluginDef && pluginDef.settingsChanged) {
                await pluginDef.settingsChanged(data.params.settings);
              }
              sendRpc({ v: 1, id: id, kind: "result", result: null });
            } else if (data.method === "plugin.dispose") {
              if (pluginDef && pluginDef.dispose) {
                await pluginDef.dispose();
              }
              sendRpc({ v: 1, id: id, kind: "result", result: null });
            } else if (data.method === "strategy.check") {
              if (!pluginDef || !pluginDef.strategy) throw new Error("Plugin provides no strategy");
              var checkRes = pluginDef.strategy.check(data.params.input);
              sendRpc({ v: 1, id: id, kind: "result", result: checkRes });
            } else if (data.method === "strategy.decide") {
              if (!pluginDef || !pluginDef.strategy) throw new Error("Plugin provides no strategy");
              var decideRes = await pluginDef.strategy.decide(data.params.input, data.params.rng);
              sendRpc({ v: 1, id: id, kind: "result", result: decideRes });
            } else if (data.method === "ideaSource.fetch") {
              if (!pluginDef || !pluginDef.ideaSource) throw new Error("Plugin provides no ideaSource");
              var fetchRes = await pluginDef.ideaSource.fetch(data.params.req);
              sendRpc({ v: 1, id: id, kind: "result", result: fetchRes });
            } else {
              sendRpc({
                v: 1,
                id: id,
                kind: "error",
                error: { code: "NOT_SUPPORTED", message: "Unknown method " + data.method }
              });
            }
          } catch (err) {
            sendRpc({
              v: 1,
              id: id,
              kind: "error",
              error: {
                code: err && err.code ? err.code : "PLUGIN_ERROR",
                message: err && err.message ? err.message : String(err)
              }
            });
          }
        }
      });

      try {
        ${bundleCode}
      } catch (loadErr) {
        sendRpc({
          v: 1,
          kind: "event",
          name: "plugin.loadError",
          payload: { message: loadErr.message || String(loadErr) }
        });
      }
    })();
  </script>
</body>
</html>`;

    iframe.srcdoc = srcdoc;

    const mountParent = container ?? document.body;
    mountParent.appendChild(iframe);

    this.iframe = iframe;
    this.endpoint = new IframeRpcEndpoint(iframe);

    return { iframe, endpoint: this.endpoint };
  }

  destroy(): void {
    if (this.endpoint) {
      this.endpoint.destroy();
      this.endpoint = undefined;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = undefined;
    }
  }
}
