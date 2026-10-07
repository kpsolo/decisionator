# Unread bar example

An example plugin for Deci that replaces the default unseen marker (contract `option-view`
1.0.0). It keeps its own per-person `seen` property (contract `option-properties` 1.0.0) and asks
the host for exposure: once an option has stayed on screen for `seconds` (default 5), it is
marked seen.

- Unseen options get `{ variant: "bar", label: "Not seen", tone: "info", replace: true }`: a blue
  left bar instead of the built-in dot.
- The detail view offers "Mark as seen" and "Mark as not seen".
- The manifest declares `optionView.replaces: ["marker"]`. When this plugin and the built-in
  "Option status" plugin are both enabled, Settings shows "Marker style" to choose between them.
  Until the viewer chooses, the one enabled first is used.

The source has type-only imports, so the web app can load it in development: set
`localStorage["deci.devPlugins"]` to `["org.decisionator.examples.unread-bar"]` and reload (see
`apps/web/src/features/option-view/dev-plugins.ts`).

## Testing

```bash
pnpm vitest run examples/plugin-unread-bar
```
