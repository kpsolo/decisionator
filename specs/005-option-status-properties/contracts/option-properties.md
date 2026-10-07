# Contract: Option Properties — v1.0.0

Plugins declare extra properties for options. Values are stored as project entries and shown,
checked, exported and restored by the host. Data shapes are defined in
[data-model.md](../data-model.md).

## Declaration (plugin manifest)

```json
"provides": {
  "optionProperties": [
    { "key": "cost", "label": "Cost per person", "type": "number", "scope": "shared", "cardBadge": true }
  ]
}
```

- `manifest.schema.json` gains `provides.optionProperties` (array, ≤ 20 items) and
  `platform.optionProperties` (semver range).
- The host provides `optionProperties: "1.0.0"`.
- A manifest whose declarations break the rules in data-model.md is refused with a message
  naming the property.

## Identity

A property is identified by `(plugin id, key)`. Two plugins may use the same key; the host
labels each with its plugin name when both are shown (US3 scenario 5).

## Storage (ProjectStore contract 1.3.0 → 1.4.0)

1. `append(ref, [{ kind: "property", optionId, plugin, key, scope, value }])` records a value.
   The store stamps `id`, `at` and `by`, and keeps `byName` as for grades.
2. Stores check shape only: the field types above, a JSON-serialized `value` of ≤ 2 KiB, and
   an existing `optionId`. Type checks against declarations happen in the host
   (`checkPropertyValue`), because stores do not know the plugins.
3. Latest wins: per `(plugin, key, optionId)` for `shared`, per `(by, plugin, key, optionId)`
   for `person`. `value: null` stays as the newest entry and clears the value.
4. `shared` values may be appended only by the owner. A non-owner append of `shared` is refused
   with `PERMISSION_DENIED`.
5. `onBehalfOf` is allowed for `property` only with `scope: "person"`. Otherwise the call is
   refused with `PERMISSION_DENIED`.
6. `openProject` returns `properties: PropertyValue[]`, effective values only. Values of
   plugins the host does not know are returned unchanged.
7. Password-protected projects store `value` encrypted, as they do for comment bodies.

The contract kit (`runProjectStoreContractTests`) covers rules 1–6 for every store.

## Host behaviour

- **Render**: in the detail view's property section, in plugin order, then declaration order.
  - Shared values are editable by the owner; per-person values only by their owner.
  - `hidden: true` properties are not rendered by the host.
  - `cardBadge: true` adds `label: value` to the card's badges.
- **Validate**: before append, `checkPropertyValue(def, value)`. A failure shows
  `"<label>: <expected>"`, for example "Cost per person: enter a number", and nothing is saved.
- **Invalid stored value** (for example, after a plugin changed a type): shown as "Invalid
  value" to people who may edit it, and ignored elsewhere. It is never converted.
- **Disabled or unknown plugin**: nothing is rendered; the values stay in the snapshot, exports
  and restores.
- **Visibility**: `person` values of other participants are never rendered or offered to
  plugins. `ctx.values` holds only the viewer's own `person` values plus shared ones.

## Export / restore

- JSON `properties[]` (optional, default `[]`, so v1 files without it still load).
- XLSX sheet "Properties".
- Restore and Move re-append `person` values on behalf of each author, and `shared` values as
  the restoring owner.

## Live share (live-share 3.0.0, proto 3)

- **Guest entry**: `{ kind: "property", optionId, plugin, key, scope: "person", value }`.
- **Host**: accepts it for active options, with `scope: "person"` and `value` ≤ 2 KiB.
  Otherwise it sends `ack invalid` with "That change is not allowed."
- **Redaction**: each guest's snapshot carries shared values and that guest's own `person`
  values only.

## Agent API (agentic-api next minor)

- `GET /context` → `optionProperties` (declarations of enabled plugins) and shared `properties`.
- `PUT /options/{optionId}/properties/{plugin}/{key}` with `{ value }`:
  - shared properties only;
  - checked with `checkPropertyValue`;
  - attributed to the agent.
  - `400` with the validation message on a bad value; `403` for a `person` property.
- MCP: `get_option_properties`, `set_option_property`.

## Versioning

| Change | Bump |
|---|---|
| New property type or optional declaration field | minor |
| Removing a type, changing latest-wins or permission rules | major |
