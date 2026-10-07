# Contract: Option View Extension — v1.0.0

Plugins change defined places of the option card and option detail view, add a summary and
filters to the option list, and learn when an option has been looked at. Contributions are
data. The host renders them with its own components, so plugins never inject markup. The shapes
are in [data-model.md](../data-model.md).

## Places

| Place | Card | Detail view | Notes |
|---|:-:|:-:|---|
| `marker` | ✓ | ✓ | one per option; a replacing marker stands in for the default |
| `badges` | ✓ | ✓ (header) | added in plugin order; ≤ 3 per plugin |
| `footer` | ✓ | ✓ | text or action buttons; ≤ 3 per plugin |
| `properties` | — | ✓ | rendered by the host from declarations (option-properties.md) |
| `sections` | — | ✓ | below the option's own content, above comments |
| list `summary` / `filters` | project options header | — | from `optionList` |

The title, grade control, comments and ballot are not places. No contribution can reach them
(FR-022).

## Plugin hooks (`PluginDefinition` additions; runtime contract minor bump)

```ts
optionView?(ctx: OptionViewContext): OptionViewContribution | Promise<OptionViewContribution>;
optionList?(ctx: OptionListContext): OptionListContribution | Promise<OptionListContribution>;
onOptionAction?(ctx: OptionViewContext, actionId: string): void | Promise<void>;
onOptionExposed?(ctx: ExposureContext, optionIds: string[]): void | Promise<void>;
```

The manifest declares what the plugin uses:

```json
"provides": { "optionView": { "places": ["marker", "badges", "footer", "sections", "list"],
                              "replaces": ["marker"] },
              "exposure": true }
```

```ts
interface OptionViewContext {
  option: Option;                 // as the viewer sees it
  viewerId: string;               // participant id of the viewer
  surface: "card" | "detail";
  values: Record<string, PropertyScalar>;   // this plugin's effective values for the option, viewer-visible only
  settings: Record<string, unknown>;        // this plugin's settings
  setValue(key: string, value: PropertyScalar): Promise<void>;  // own properties only; FR-012 enforced
}
interface OptionListContext {
  options: Option[];              // active options in view order
  viewerId: string;
  valuesByOption: Record<string, Record<string, PropertyScalar>>;
  settings: Record<string, unknown>;
}
interface ExposureContext {
  viewerId: string;
  settings: Record<string, unknown>;
  setValues(changes: { optionId: string; key: string; value: PropertyScalar }[]): Promise<void>;
}
```

Exposure:

- The plugin chooses its threshold with `exposureMs(settings): number | null`. `null` turns
  exposure off.
- The host calls `onOptionExposed` with batches, at most once a second, listing options that
  have been on screen without a break for that long and were not reported yet in this page
  visit.
- "On screen" and pausing follow research R5.

Sandboxed plugins (when the runtime loader lands, US6) get the same hooks over RPC as
`optionView.render`, `optionList.render`, `optionView.action` and `exposure.exposed`. The
results cross the boundary unchanged because they are plain data.

## Host rules

1. **When hooks run**: for every visible option, and again when the option, the plugin's values
   or its settings change. Results are cached per `(plugin, option, surface, values version)`.
   A hook that takes longer than 200 ms keeps the previous result (or the default) until it
   resolves.
2. **Validation**: contributions are validated (zod) against the shapes in data-model.md.
   Invalid parts are dropped, and the place shows its default with the notice "A plugin could
   not display here." The rest of the option works (FR-024). Thrown errors are handled the same
   way.
3. **Marker choice**: among enabled plugins that declare `replaces: ["marker"]`, use the
   viewer's choice (`deci.optionView.markerPlugin`), otherwise the first enabled. The other
   plugins' marker contributions are ignored. Plugins that do not replace the marker show
   nothing in the marker place.
4. **Ordering**: badges, footer items and sections appear in plugin order (registry order), then
   in contribution order.
5. **Accessibility**:
   - markers render as an icon plus a visually hidden `label`, and never as colour alone;
   - actions are buttons with the given label;
   - tones map to theme tokens with WCAG AA contrast;
   - Markdown is rendered with the app's sanitizing renderer.
6. **Disable**: disabling a plugin removes its contributions immediately, with no reload, and
   stops exposure tracking when no enabled plugin needs it.
7. **Actions**: the host calls `onOptionAction`. While it runs, the button is busy; an error
   shows a toast "<plugin name>: <message>".

## Default unseen marker (built-in `org.decisionator.option-status`)

| Effective `seen` | Card | Detail view |
|---|---|---|
| none or `not_seen` | marker `{ variant: "dot", label: "Not seen", tone: "primary", replace: true }`; title drawn bold (the `dot` variant implies bold title) | same marker in the header |
| `seen` / `seen_auto` | no marker | no marker; footer action "Mark as not seen" |
| none / `not_seen` | footer action "Mark as seen" | footer action "Mark as seen" |

- The list summary is "N not seen yet" (`N` counted over active options; hidden when 0).
- The list filter is "Only not seen", with `where: { key: "seen", in: [null, "not_seen"] }`.
