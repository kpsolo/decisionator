# Contract: Agentic API — v1.0.0

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
  `X-Agent-Name` header. That name is stored in `ActorRef.agentName`.

## Operations

| MCP tool | REST | Permission | Description |
|----------|------|-----------|-------------|
| `agent_hello` | `POST /session` | any | Declares the agent name. Returns the request instruction, target, permissions, expiry, limits and the rules text. |
| `get_request` | `GET /request` | any | The agent request: instruction, target, status. |
| `get_context` | `GET /context` | `read` | Project title and description, the options in scope (all options for a project target), **accepted** contributions and source refs. Ballots and other agents' pending contributions are never included. |
| `list_contributions` | `GET /contributions` | `read` | This request's own contributions and their review status. |
| `add_contribution` | `POST /contributions` | `contribute` | `{target?, type, body, pros?, cons?, sources[]}`. `target` defaults to the request target and must be inside the scope. Result: `{id, reviewStatus: "pending"}`. |
| `update_contribution` | `PATCH /contributions/{id}` | `contribute` | Only own contributions that are still `pending`. |
| `propose_option` | `POST /options` | `propose_options` | `{title, description, sources[]}`. Creates an option with `status: "proposed"`. Valid only when the target is a project. |
| `complete_request` | `POST /complete` | any | `{summary?}`. Marks the request `completed`, and the grant stops accepting writes. |

**No operation** exists to record outcomes, cast ballots, delete content, change sharing or read
outside the scope (FR-044). Asking for any of these returns `403 NOT_PERMITTED_FOR_AGENTS`.

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

## Limits (research R8)

| Limit | Value | Error |
|-------|-------|-------|
| Contribution body | 64 KB | 413 `TOO_LARGE` |
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
- a check that the MCP tool list and the OpenAPI document expose the same operations.
