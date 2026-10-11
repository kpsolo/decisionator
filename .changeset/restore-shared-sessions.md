---
"@decisionator/share-inpage": minor
"@decisionator/node": minor
"@decisionator/web": patch
"@decisionator/core": patch
---

Restore shared sessions across devices and disconnects:
- `@decisionator/share-inpage` (3.1.0): NIP-78 parameterized replaceable events (`kind 30078`) host Schnorr signing and verification, dynamic role toggling (`setRole`), closing frames with revocation code (`session_revoked`), and participant vote drop notification handling.
- `@decisionator/node` (1.2.0): Agentic API v1.2.0 with `get_live_session` and `propose_moderation` (REST and MCP tools), `moderate_session` permission enforcement, per-grant participant pseudonymization, pending proposal management, and audit event recording (`agent_moderation_proposed`, `agent_moderation_accepted`, `agent_moderation_dismissed`).
- `@decisionator/web`: IndexedDB `live_sessions` cache with LRU eviction for guest offline deliberation viewing, host reload recovery, Sessions Dashboard (`/sessions`), interactive participant roster, "Drop votes", "Read-only" toggle switch, link revocation dialog with relay tombstone publishing, "Save to my workspace" session forking into independent projects, and pending agent moderation proposal acceptance in the live panel.
- `@decisionator/core`: Added `moderate_session` permission and agent moderation audit event types.
