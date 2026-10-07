# Quickstart: validating 005

Prerequisites: Node 24, pnpm 10, Playwright browsers installed (`pnpm exec playwright install`).

## Automated checks

```bash
pnpm vitest run packages/core packages/plugin-sdk plugins apps/web/src examples
```

These cover:

- `checkPropertyValue`;
- the ProjectStore contract kit with property cases, for every store;
- the share-inpage property submit and redaction tests;
- `ExposureTracker`;
- the status plugin logic;
- view-contribution validation;
- export round-trips.

```bash
pnpm -C apps/web exec playwright test e2e/option-status.spec.ts e2e/option-properties.spec.ts --project=chromium
```

These cover:

- US1 scroll and marks;
- the US2 Settings time and turning automatic marking off;
- US3 with the example cost plugin, including export → restore and disable → enable;
- the US4 marker replacement and badge;
- a live guest's marks staying private;
- axe checks.

## Manual walk-through (local store, `pnpm dev`)

1. Create a project with 12 options. Every card shows the "new" dot and a bold title, and the
   header says "12 not seen yet".
2. Keep the first three cards on screen for 6 s. They lose the dot, and the header says
   "9 not seen yet".
3. Scroll quickly past cards 4–6. They keep the dot.
4. Turn on "Only not seen". Cards 4–12 are listed.
5. Open "Lisbon" (the detail view). The marker is in its header and the footer shows "Mark as
   not seen". Click it: the card is new again, and it stays new while you keep it on screen.
   Reload, wait 5 s: it is Seen.
6. Settings → Options:
   - set 10 s; a card kept on screen for 7 s stays new;
   - turn automatic marking off; nothing is marked automatically.
7. Plugins: disable "Option status". The dots, the count and the filter disappear at once, and
   grading still works. Enable it again: the earlier marks are back.
8. Start a live session and join as a guest in another browser. The guest's marks appear only
   in the guest's view. The owner sees no change.
9. Export as JSON and as Excel, then restore. The marks are restored for their authors.
10. Grade "Lisbon" 3, then 4. Hover over or focus your stars: "You rated 4 · …" and "Changed from 3
    at …". The average shows "Last rating · …". "Mark as not seen" shows "Seen automatically · …".
11. As the owner, open the menu → "Reset…" → choose Tom → confirm "Clear 3 grades and 1 ballot
    from Tom?". Tom's ratings leave the averages, and an earlier outcome still verifies.
12. As Gina, choose "Mark all as not seen": every option is new for her only.
13. On the vote page, open "Decision method" and choose "Weighted grades". The page says "Decided
    by: Weighted grades". Close and tally: the outcome names Weighted grades.
14. Results → "Compare strategies": one row per strategy, with differences marked. Reopen it: the
    random draw is the same. Adopt one: a new outcome appears, and the chosen method is unchanged.
