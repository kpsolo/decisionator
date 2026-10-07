# Data Model: Personal Option Status and Plugin-Defined Option Properties

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## OptionPropertyDefinition (manifest, `provides.optionProperties[]`)

| Field | Type | Rules |
|---|---|---|
| `key` | string | `^[a-z][a-z0-9_]{0,39}$`, unique within the plugin |
| `label` | string | 1–40 chars, shown to people |
| `type` | `"text" \| "number" \| "boolean" \| "choice" \| "date"` | |
| `choices` | `{ value, label }[]` | required for `choice` (1–20 items), forbidden otherwise; `value` matches the key pattern |
| `default` | scalar | optional; must pass `checkPropertyValue` |
| `scope` | `"shared" \| "person"` | `shared`: one value per option, written by the owner or invited agents; `person`: one value per participant per option, written only by that participant |
| `cardBadge` | boolean | default `false`; when `true` and a value is set, the host shows `label: value` in the card's badge area |
| `hidden` | boolean | default `false`; when `true`, the host does not render the value in the property section, and the plugin presents it through its view contribution instead (used by the status plugin) |

**Value rules** (`checkPropertyValue(def, value)` in `@decisionator/core`):

| Type | Accepted value |
|---|---|
| `text` | string of 1–500 chars |
| `number` | finite number |
| `boolean` | `true \| false` |
| `choice` | one of `choices[].value` |
| `date` | `YYYY-MM-DD` that is a real calendar date |

`null` is always accepted and means "clear the value".

## PropertyValue (entry kind `property`; snapshot `properties[]`)

| Field | Type | Rules |
|---|---|---|
| `id` | string | store-assigned |
| `at` | ISO time | store-stamped |
| `by` | participant id | store-stamped (or the delegate, for `onBehalfOf`) |
| `byName` | string? | as for grades |
| `optionId` | string | must name an existing option; a removed option keeps its values (edge case: restored options keep their status) |
| `plugin` | string | plugin id (manifest `id`) |
| `key` | string | property key |
| `scope` | `"shared" \| "person"` | |
| `value` | string \| number \| boolean \| null | serialized ≤ 2 KiB; `null` clears |

**Effective value** (latest wins, applied by each store as for grades):

- `shared`: the newest entry per `(plugin, key, optionId)`;
- `person`: the newest entry per `(by, plugin, key, optionId)`.

**Who may append**:

- `shared`: the owner; an agent through the agent API under an owner grant; never by delegation.
- `person`: any participant for themselves; delegation (`onBehalfOf`) allowed, so the live
  share can record a guest's own value.

**Visibility in the product**: a participant sees shared values and only their own `person`
values. Exports carry everything.

## Entry union addition (ProjectStore contract 1.4.0)

```ts
| { kind: "property"; optionId: string; plugin: string; key: string;
    scope: "shared" | "person"; value: string | number | boolean | null }
```

- `DELEGATABLE_ENTRY_KINDS` gains `property`, valid only with `scope: "person"`.
- A delegated `shared` property is refused with `PERMISSION_DENIED`.

## Personal option status (built-in plugin `org.decisionator.option-status`)

One declared property:

```
{ key: "seen", label: "Seen", type: "choice", scope: "person", hidden: true,
  choices: [ { value: "seen", label: "Seen" },
             { value: "seen_auto", label: "Seen" },
             { value: "not_seen", label: "Not seen" } ] }
```

| Effective value | Meaning | Shown as |
|---|---|---|
| none / `null` | never marked | new (unseen marker) |
| `seen_auto` | marked by exposure | Seen |
| `seen` | marked by hand | Seen |
| `not_seen` | marked "not seen" by hand | new |

Transitions:

```
none ──exposed(minMs)──▶ seen_auto
none / seen_auto / not_seen ──"Mark as seen"──▶ seen
seen / seen_auto ──"Mark as not seen"──▶ not_seen     (no auto re-mark for the rest of the page visit)
not_seen ──exposed, on a later page visit──▶ seen_auto
```

The unseen filter is `where: { key: "seen", in: [null, "not_seen"] }`. The summary is
"N not seen yet", counted over active options.

## AutomaticMarkingSetting (status plugin settings, per device)

| Field | Type | Default | Rules |
|---|---|---|---|
| `autoMark` | boolean | `true` | |
| `seconds` | integer | `5` | 1–300 |

## OptionViewContribution (returned by `optionView(ctx)`)

```ts
{
  marker?: { variant: "dot" | "bar" | "bold" | "ring"; label: string; tone?: Tone; replace?: boolean } | null;
  badges?: { text: string; tone?: Tone; icon?: IconName; title?: string }[];   // ≤ 3, text ≤ 24
  footer?: ({ text: string } | { action: { id: string; label: string } })[];  // ≤ 3
  sections?: { title: string; blocks: Block[] }[];                              // detail view only, ≤ 2
}
Block = { text: string } | { markdown: string } | { fields: [string, string][] }
Tone  = "neutral" | "info" | "success" | "warning" | "danger" | "primary"
```

- `marker` is shown only when the contribution returns one, which the status plugin does for
  unseen options.
- With `replace: true` it competes for the marker place: the participant's chosen plugin wins,
  otherwise the first enabled.
- A contribution that fails validation, or a hook that throws, renders the default for each
  affected place, plus the notice "A plugin could not display here."

## OptionListContribution (returned by `optionList(ctx)`)

```ts
{ summary?: { text: string };                                         // ≤ 40 chars
  filters?: { id: string; label: string; where: { key: string; in: (string | number | boolean | null)[] } }[] }
```

`where.key` refers to the plugin's own property. The host evaluates it against the viewer's
effective values (their own for `person`, the shared value otherwise).

## ExposureTracker (host, pure)

| Input | Effect |
|---|---|
| `observe(id, ratio, visibleHeight, viewportHeight, now)` | the element is "on screen" when `ratio ≥ 0.5` or `visibleHeight ≥ 0.5 × viewportHeight`; the timer starts when it becomes on screen and resets when it is not |
| `pageVisible(false \| true, now)` | pauses or resumes every timer (time while hidden does not count) |
| `tick(now)` | emits each id whose on-screen time is ≥ `minMs` and that has not been emitted this page visit |
| `setMinMs(ms)` | applies to running timers |

## Storage layouts

| Store | Where |
|---|---|
| store-file | `StoredFileProject.properties: PropertyValue[]` (missing → `[]`) |
| store-local | Automerge `properties` list |
| store-firestore | `entries/{id}` with `kind: "property"` |
| store-google-sheets | tab `properties` with columns `id, at, by, optionId, payload`; `payload` = `{plugin,key,scope,value,byName?}` JSON (or `enc:v1:` in password mode) |
| export JSON | `properties[]`, optional, default `[]` |
| export xlsx | sheet "Properties": Option, Plugin, Key, Scope, Value, By, By name, At, Record (JSON) |
