---
"@decisionator/store-google-sheets": patch
---

Google Sheets store fixes:
- Write queue: each (spreadsheet, tab) group is flushed on its own. A group Google refuses for good (403, 404, 400) is parked in IndexedDB and reported in `FlushResult.failed` instead of blocking every other project's rows; `getFailed`, `retryFailed` and `discardFailed` manage parked rows, and they are no longer counted as queued. On 429 or other transient errors the queue backs off (truncated exponential via `QuotaBudget`, `Retry-After` honoured) and retries by itself. Flushes are serialized per instance and across tabs with the Web Locks API, and rows are appended to a range as wide as the tab (contributions use `A:F`).
- New `store.flushPending()` sends queued rows without a new append, and `store.startAutoFlush()` does so on start, when the browser comes back online and when the tab becomes visible. `append` throws when Google refused the rows of the project it was called for.
- `openProject` counts a row of an append-only tab that appears twice with the same id once.
- A password-protected project's Drive file is created with the neutral name "Deci project (protected)" instead of the plaintext title.
- `updateOptions` writes each changed option to its own sheet row and appends new ones after the last row. Rows that could not be decoded are no longer overwritten or shifted.
- Contributions are stamped with the signed-in user and the current time (caller-supplied `by`/`at` are ignored), and only the owner may append outcomes (`PERMISSION_DENIED` otherwise).
- Sign-in: a blocked or closed Google popup rejects instead of leaving the request pending. On HTTP 401 the client drops the token, requests a new one once and retries the request once; a second 401 fails with `UnauthorizedError`.
- `watch` checks the Drive file version every 10 s while the tab is visible and reads the whole project only when it changed (at most every 15 s), instead of a full read every 10 s.
