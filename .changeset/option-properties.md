---
"@decisionator/core": minor
"@decisionator/plugin-sdk": minor
"@decisionator/store-file": minor
"@decisionator/store-local": minor
"@decisionator/store-firestore": minor
"@decisionator/store-google-sheets": minor
---

Option properties (ProjectStore contract v1.4.0). Plugins can declare typed properties on options (`text`, `number`, `boolean`, `choice`, `date`), either `shared` (one value per option, set by the owner) or `person` (one value per participant per option). Values are recorded with the new `property` entry kind, `append(ref, [{ kind: "property", optionId, plugin, key, scope, value }])`, and returned as effective values in `ProjectSnapshot.properties`: latest wins per (plugin, key, option) for shared values and per author for person values, and `value: null` clears a value. Stores check shape only (valid key, scalar value of at most 2 KiB, existing option); a non-owner shared value or a delegated shared value is refused with `PERMISSION_DENIED`, and a rejected call writes nothing. Password-protected projects store values encrypted. `@decisionator/core` adds the property model (`PropertyValue`, `checkPropertyValue`, `propertySlot`, `effectivePropertyValues`), the plugin SDK adds `checkPropertyEntries` and `propertyRecord` for store authors, and the contract kit covers the new rules.
