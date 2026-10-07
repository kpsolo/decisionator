# Option cost example

An example plugin for Deci that adds its own properties to options (contract
`option-properties` 1.0.0) and shows them on the option card and in the detail view (contract
`option-view` 1.0.0).

The manifest declares three properties. The host renders the inputs, checks the values and
stores them; the plugin code never touches storage:

| Key | Label | Type | Scope |
|---|---|---|---|
| `cost` | Cost per person | number | shared (set by the owner), shown as a card badge |
| `shortlisted` | Shortlisted | boolean | person (each participant sets their own) |
| `priority` | Priority | choice: Low, High | shared |

`optionView` adds a "€420" badge to the card and a "Budget" section with the values to the
detail view.

The source has type-only imports, so the web app can load it in development: set
`localStorage["deci.devPlugins"] = '["org.decisionator.examples.option-cost"]'` and reload (see
`apps/web/src/features/option-view/dev-plugins.ts`).

## Testing

```bash
pnpm vitest run examples/plugin-option-cost
```
