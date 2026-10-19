# Contract: Agentic API — v1.3.0

> **Scope: post-MVP (US5).** The MVP supports agents only through the copy-paste [format instruction](./format-instruction.md).

The local node exposes one command layer through two transports. Both are generated from the
same Zod schemas, so they stay in parity (Principle IV, FR-040).

| Transport | Endpoint | Discovery |
|-----------|----------|-----------|
| MCP (spec 2026-07-28, Streamable HTTP) | `http://127.0.0.1:4178/mcp` or, for remote agents, `https://<relay>/t/<tunnelId>/mcp` | MCP tool listing |
| MCP stdio bridge | `npx decisionator mcp --url <mcp-url>` (token via `DECISIONATOR_TOKEN`) | same |
| REST | `http://127.0.0.1:4178/api/v1` (or tunnel equivalent) | `GET /api/v1/openapi.json` (OpenAPI 3.1) |

## Authentication and scope

- Every call carries `Authorization: Bearer <grant-token>`. The token comes from an agent
  request ([data-model.md § AgentRequest](../data-model.md)).
- The node resolves token → grant and checks, in order: grant `open` and not expired → target
  still exists → operation permitted by `permissions` → rate and size limits.
- Failures return MCP tool errors or REST `401/403/404/409/413/429` with a plain-language
  `message`. Refused writes outside the scope are appended to the project's `auditLog` (FR-044,
  US5 #4).
- The agent sets its self-declared name once, through `agent_hello`, or per call with the
  `X-Agent-Name` header. That name is stored in `ActorRef.agentName`. It is 1–100 characters
  (otherwise 400 `INVALID_PARAMS`) and is applied only after the call's grant check passed, so a
  refused, revoked or expired grant is never renamed (1.3.0).
- Agent grant tokens never act as the owner: the [owner bridge](#owner-bridge-130) takes a
  separate owner token (1.3.0).

## Operations

| MCP tool | REST | Permission | Description |
|----------|------|-----------|-------------|
| `agent_hello` | `POST /session` | any | Declares the agent name. Returns the request instruction, target, permissions, expiry, limits and the rules text. |
| `get_request` | `GET /request` | any | The agent request: instruction, target, status. |
| `get_context` | `GET /context` | `read` | Project title and description, the options in scope (all options for a project target), **accepted** contributions, source refs, `optionProperties` and shared `properties` (see [Option properties](#option-properties-110)). Ballots, per-person property values and other agents' pending contributions are never included. |
| `list_contributions` | `GET /contributions` | `read` | This request's own contributions and their review status. |
| `add_contribution` | `POST /contributions` | `contribute` | `{target?, type, body, pros?, cons?, sources[]}`. `target` defaults to the request target and must be inside the scope. Result: `{id, reviewStatus: "pending"}`. |
| `update_contribution` | `PATCH /contributions/{id}` | `contribute` | Only own contributions that are still `pending`. |
| `propose_option` | `POST /options` | `propose_options` | `{title, description, sources[]}`. Creates an option with `status: "proposed"`. Valid only when the target is a project. |
| `complete_request` | `POST /complete` | any | `{summary?}`. Marks the request `completed`, and the grant stops accepting writes. |
| `get_option_properties` | `GET /properties` | `read` | `{optionProperties, properties}`: the property declarations of enabled plugins and the effective shared values of the options in scope. |
| `set_option_property` | `PUT /options/{optionId}/properties/{plugin}/{key}` | `contribute` | Body `{value}` (MCP: `{optionId, plugin, key, value}`). Sets a **shared** property value; `null` clears it. Result: the stored `PropertyValue`. |
| `get_live_session` | `GET /live-session` | `read`, project target | `{hosting, readOnly, revoked, participants}` with per-grant pseudonymous `participantId`s; 404 `NOT_HOSTING` when no tab hosts. Grants without `read` or scoped to an option or idea get 403 (1.3.0; the roster names people). |
| `propose_moderation` | `POST /live-session/proposals` | `moderate_session` | `{action, participant?, reason}`. `participant` must be a pseudonym this grant got from `get_live_session`; anything else is 400 `INVALID_PARAMS` (1.3.0). Creates a pending proposal only; the owner decides. |

Contributions are stored in the grant's project; the target only says what they are about
(1.3.0).

**No operation** exists to record outcomes, cast ballots, delete content, change sharing, decide
moderation proposals or read outside the scope (FR-044). Asking for any of these returns
`403 NOT_PERMITTED_FOR_AGENTS`.

## Owner bridge (1.3.0)

The owner's hosting tab pushes the live-session summary and decides moderation proposals over
REST. These routes are not agent operations (they are not MCP tools and not in the OpenAPI
document) and take the **owner token**, never a grant token:

| REST | Description |
|------|-------------|
| `PUT /live-session?projectId=<id>` | Body: the session summary (`{hosting, readOnly, revoked, participants[≤500]}`, validated) or `null` to end it. 400 on a malformed body. |
| `GET /live-session/proposals?projectId=<id>` | `{proposals}` of that project. |
| `POST /live-session/proposals/{id}/decision?projectId=<id>` | `{decision: "accepted" \| "dismissed"}`. Only a proposal of that project; otherwise 404. Audited as `agent_moderation_accepted` / `agent_moderation_dismissed`. |

- `Authorization: Bearer <owner-token>`. The token is configured when the node starts
  (`ownerToken` option or `DECISIONATOR_OWNER_TOKEN`, at least 32 characters); without one the
  node generates a random token and returns it to the process that started it, which hands it
  to the owner's app only.
- An agent grant token gets 403 `NOT_PERMITTED_FOR_AGENTS` (audited as
  `agent_refused_permission`, reason `owner_only`); any other token gets 401 `UNAUTHORIZED`.

### `add_contribution` input schema (excerpt)

```json
{
  "type": "object",
  "required": ["type", "body"],
  "properties": {
    "target": {
      "oneOf": [
        { "type": "object", "required": ["kind"], "properties": { "kind": { "const": "project" } } },
        { "type": "object", "required": ["kind", "optionId"], "properties": { "kind": { "const": "option" }, "optionId": { "type": "string" } } },
        { "type": "object", "required": ["kind", "ideaId"], "properties": { "kind": { "const": "idea" }, "ideaId": { "type": "string" } } }
      ]
    },
    "type": { "enum": ["note", "research", "pros_cons", "link"] },
    "body": { "type": "string", "maxLength": 65536 },
    "pros": { "type": "array", "items": { "type": "string" }, "maxItems": 50 },
    "cons": { "type": "array", "items": { "type": "string" }, "maxItems": 50 },
    "sources": {
      "type": "array", "maxItems": 20,
      "items": { "type": "object", "required": ["url"], "properties": {
        "title": { "type": "string" }, "url": { "type": "string", "pattern": "^https?://" }, "accessedAt": { "type": "string" } } }
    }
  }
}
```

## Option properties (1.1.0)

Plugins declare option properties ([option-properties](../../005-option-status-properties/contracts/option-properties.md)).
Agents read and write only **shared** values; per-person values belong to people and are never
exposed to agents.

- `optionProperties`: each declaration of an enabled plugin (`key`, `label`, `type`, `choices?`,
  `default?`, `scope`, `cardBadge`, `hidden`) plus the declaring `plugin` id.
- `properties`: effective shared `PropertyValue`s (latest wins per plugin, key and option) of the
  options in scope. A cleared value stays as `value: null`.
- `set_option_property` permission is `contribute` (no separate permission); the option must be
  inside the grant's scope. Values are written directly, not reviewed, and attributed to the agent:
  `by: "agent:<requestId>"`, `byName` = the declared agent name. Each write is appended to the
  audit log as `agent_property_set`.

| Case | REST | MCP |
|------|------|-----|
| Body without `value` | 400 `INVALID_PARAMS` | schema error |
| Unknown option, or property not declared by an enabled plugin | 404 `NOT_FOUND` | `[404] NOT_FOUND` tool error |
| Property with `scope: "person"` | 403 `NOT_PERMITTED_FOR_AGENTS`, "Only the person it belongs to can set this property." (audited as `agent_refused_permission`) | same, as a tool error |
| Value fails `checkPropertyValue` | 400 `INVALID_PARAMS` with the check's message, e.g. "Stage: choose one of Lead, Won" | same, as a tool error |
| Value over 2048 bytes as JSON | 413 `TOO_LARGE` | same, as a tool error |
| Option outside the grant's scope | 403 `OUT_OF_SCOPE` | same, as a tool error |

## Limits (research R8)

| Limit | Value | Error |
|-------|-------|-------|
| Contribution body | 64 KB (65 536 bytes as UTF-8) | 413 `TOO_LARGE` |
| Each pro or con of a contribution | 2 000 characters | 400 `INVALID_PARAMS` |
| Agent name (`agent_hello`, `X-Agent-Name`) | 100 characters | 400 `INVALID_PARAMS` |
| `complete_request` summary | 4 000 characters; body must be an object | 400 `INVALID_PARAMS` |
| Request body (REST and MCP) | 1 MB | 413 `TOO_LARGE` |
| Sources per contribution | 20 | 400 `INVALID_PARAMS` |
| Contributions per request | 50 | 409 `LIMIT_REACHED` |
| Calls per minute per grant | 60 | 429 `RATE_LIMITED` |
| Default / max grant lifetime | 24 h / 30 days | 401 `EXPIRED` |

## Agent brief (UI → user → agent)

When the user clicks "Ask my agent", the UI renders a copyable text block. Its sections, in
order:
1. **Task**: the user's instruction and the target title.
2. **How to connect**: the MCP URL, the REST base URL with its OpenAPI URL, and the bearer token.
3. **Rules**: everything the agent adds is reviewed by a human; cite sources; call
   `complete_request` when done; the agent cannot decide on the user's behalf.
4. **Expiry**: when access ends.

The brief also offers a ready-made `claude mcp add` / JSON snippet for MCP clients. The token
is the only secret in the brief. It is scoped, expires and can be revoked (FR-042).

## Contract tests (Principle VII)

`packages/node/test/contract/agentic-api.*` — for **both** MCP and REST, these tests cover:
- each operation's happy path;
- each permission denial;
- expired, revoked and cancelled grants;
- out-of-scope targets;
- limits;
- a check that the MCP tool list and the OpenAPI document expose the same operations.- option properties: declarations and shared-only values in context, set/clear, attribution,
  bad value, person refusal, unknown option or property, scope (1.1.0).

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.3.0 (unreleased) | 2026-10-19 | Owner bridge takes a separate owner token (agents get 403) and a `projectId`; proposals are decided only within their project. `get_live_session` needs `read` on the whole project. `propose_moderation` rejects participants that are not this grant's pseudonyms. Contributions are stored in the grant's project. `X-Agent-Name` is applied only after authorization and capped at 100 characters; contribution bodies are measured in UTF-8 bytes; pros/cons, summaries and request bodies have limits; malformed `complete_request` and live-session bodies get 400 |
| 1.2.0 (unreleased) | — | `get_live_session`, `propose_moderation` and the `moderate_session` permission ([session-restore § 8](../../006-restore-shared-sessions/contracts/session-restore.md)) |
| 1.1.0 (unreleased) | 2026-10-07 | `get_context` also returns `optionProperties` and shared `properties`. New `get_option_properties` (`GET /properties`) and `set_option_property` (`PUT /options/{optionId}/properties/{plugin}/{key}`, `contribute`): shared values only, checked with `checkPropertyValue`, attributed to the agent, audited as `agent_property_set` (005 FR-017) |
| 1.0.0 | — | Initial contract |
