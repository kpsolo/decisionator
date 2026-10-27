---
"@decisionator/core": patch
"@decisionator/plugin-sdk": patch
"@decisionator/node": patch
"@decisionator/relay": patch
"@decisionator/share-inpage": patch
"@decisionator/store-firestore": patch
"@decisionator/web": patch
---

Upgrade dependencies with published security advisories: zod 4.6.7 (memory exhaustion on oversized constrained collections), DOMPurify 3.4.17 (sanitizer bypasses), markdown-it 15.0.3 (quadratic link-reference rendering), MCP SDK 1.32.2 and its transitive body-parser, qs, ip-address and fast-uri. `@decisionator/store-firestore` no longer depends on `firebase`, which it never imported. The agent API's OpenAPI document and `scripts/gen-schemas.ts` now use zod's native `z.toJSONSchema`. CI fails on any high or critical production advisory.
