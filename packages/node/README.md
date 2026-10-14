# @decisionator/node

Companion local daemon providing Model Context Protocol (MCP) and REST agent APIs for the Deci decision-making engine.

## Features

- **Model Context Protocol (MCP)**: Streamable HTTP transport (`/mcp`) implementing the 2026-07-28 specification.
- **REST API Parity**: Twin REST API (`/api/v1`) generated from the identical Zod schemas, with auto-generated OpenAPI 3.1 specifications (`/api/v1/openapi.json`).
- **Zero-Trust Security**: 256-bit bearer tokens, scoped permissions (`read`, `contribute`, `propose_options`, `moderate_session`), DNS rebinding protection, and rate limiting (60 rpm).
- **Human-in-the-Loop**: All contributions, proposed options, and moderation requests are staged in `pending` review.
- **Full Privacy Protection**: Voter ballots, private ratings, and person-scoped property values are never exposed to agents.

## Quick Start

```bash
# Run tests
pnpm test

# Typecheck
pnpm typecheck
```

## Documentation

For full architecture details, MCP tool schemas, client configuration snippets, and workflow examples, see:
- [Agentic MCP Documentation](../../docs/agentic-mcp.md)
- [Agentic API Specification Contract](../../specs/001-decision-engine-core/contracts/agentic-api.md)
