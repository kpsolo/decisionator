---
"@decisionator/node": minor
---

Agent API 1.1.0: agents can read and set shared option properties. `GET /context` (and MCP `get_context`) also returns `optionProperties`, the declarations of enabled plugins, and the effective shared `properties` of the options in scope; per-person values are never exposed. New `get_option_properties` (`GET /properties`) and `set_option_property` (`PUT /options/{optionId}/properties/{plugin}/{key}` with `{ value }`), which need the `contribute` permission. Values are checked with `checkPropertyValue` (400 with its message), person-scoped properties are refused with 403, unknown options or undeclared properties get 404, and `null` clears a value. Writes are attributed to the agent (`by: "agent:<requestId>"`, `byName`) and recorded in the audit log as `agent_property_set`.
