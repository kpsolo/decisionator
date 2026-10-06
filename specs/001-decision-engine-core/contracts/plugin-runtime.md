# Contract: Plugin Runtime (host ⇄ plugin RPC) — v1.0.0

> **Scope: sandboxed loading ships with US6.** In the MVP, first-party modules implement the same contracts in-process (research R26).

Applies to every plugin (built-in or third-party). Platform key: `platform.runtime`.
See [research.md R4](../research.md) for the isolation model.

## Execution environment

- Each enabled plugin runs in its own `<iframe>` served from
  `/_plugin/<id>/<version>/frame` with an opaque origin (`CSP: sandbox allow-scripts`).
- `connect-src` contains only the `net:` origins the user granted. No cookies, storage, parent
  DOM, top navigation, popups or clipboard access.
- For plugins that provide a strategy, `Math.random` and `crypto.getRandomValues` throw
  `DeterminismError`. Use `ctx.rng`.
- The frame loads the plugin's `main` bundle, which MUST call `definePlugin()` from
  `@decisionator/plugin-sdk` exactly once.

## Transport

`postMessage` with structured-clone payloads, wrapped by the SDK:

```text
Request:  { v: 1, id: string, kind: "call", method: string, params: unknown }
Response: { v: 1, id: string, kind: "result", result: unknown }
        | { v: 1, id: string, kind: "error", error: { code: string, message: string, data?: unknown } }
Event:    { v: 1, kind: "event", name: string, payload: unknown }
```

Host → plugin calls time out (default 5 s; `strategy.decide` 2 s). On timeout or 3 consecutive
errors the host destroys the frame, marks `lastError`, and shows
"<plugin name> stopped responding" (FR-052). The primary flow never awaits a non-strategy
plugin.

## Lifecycle

| Method (host → plugin) | Params | Result |
|------------------------|--------|--------|
| `plugin.init` | `{ settings, grantedPermissions, platformVersion, locale }` | `{ ok: true }` |
| `plugin.settingsChanged` | `{ settings }` | `void` |
| `plugin.dispose` | — | `void` |

## Host capabilities (plugin → host)

Exposed as `ctx.*` by the SDK. Each call is checked against `grantedPermissions`. A denied call
fails with `PERMISSION_DENIED`.

| Capability | Permission | Signature |
|------------|-----------|-----------|
| `ctx.oauth.getToken(provider, {interactive})` | `oauth:<provider>` | → `{ accessToken, expiresAt, callbackParams: Record<string,string> }` |
| `ctx.project.get()` | `project:read` | → read-only snapshot of the current project (options, contributions accepted) |
| `ctx.log(level, msg)` | none | Shown in the plugin's diagnostics panel |
| `ctx.ui.resize(height)` | UI slot | Within the slot's `maxHeight` |
| `ctx.ui.notify(msg, level)` | UI slot | Toast attributed to the plugin |
| `ctx.rng` | strategy, provided per run | see [strategy.md](./strategy.md) |

`fetch` is the standard browser `fetch`. CSP enforces the `net:` allow-list.

## Error codes

`PERMISSION_DENIED`, `TIMEOUT`, `INVALID_PARAMS`, `PRECONDITION_FAILED`, `NOT_SUPPORTED`,
`DeterminismError`, `PLUGIN_ERROR` (catch-all; message shown to user).

## Compatibility

The host loads a plugin only if every declared `platform.*` range is satisfied by the host's
contract versions. Otherwise the host refuses to load it and shows
"Built for Deci runtime ^2.0, this app provides 1.4" (US6 #4).
