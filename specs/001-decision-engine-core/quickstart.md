# Quickstart & Validation Guide: Decision Engine Core

This guide shows the feature working end to end. Each scenario maps to a user story in
[spec.md](./spec.md) and names the automated test that covers it. Contracts are in
[contracts/](./contracts/), and entities in [data-model.md](./data-model.md).
**The MVP is US1–US3.** Validation for US4–US7 is added when those increments are planned in
detail.

## Prerequisites

- Node.js 24 LTS and pnpm 10 (`corepack enable`).
- Two Google accounts: the owner and a collaborator. Use two browser profiles.
- For local development, a Google Cloud project with:
  - an OAuth Web client whose authorized JavaScript origin is `http://localhost:5173`;
  - an API key restricted to the Picker API.

  Put these in `apps/web/.env.local` as `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY`
  (research R28). The hosted build uses the project's own client.
- An AI assistant (Claude or Gemini) for the format round trip.

## Setup

```bash
pnpm install
pnpm --filter @decisionator/web dev        # http://localhost:5173
```

## Automated checks

```bash
pnpm lint && pnpm typecheck
pnpm test             # unit + contract (Vitest), including the fake Google backend
pnpm test:contract    # project-store, strategy (Borda + RNG vectors), options-format fixtures
pnpm test:e2e         # Playwright against the fake Google backend + axe accessibility checks
```

CI never calls real Google APIs. A manual "live Google" checklist (below) runs before each
release.

## Validation scenarios

### US1: Paste, format, create, grade

1. Open the app and click **New project**. Paste:
   ```text
   - Habit tracker with friends
   - Receipt splitter
   - AI recipe planner from fridge photo
   - Local events digest
   ```
   **Expect**: a choice between **Format with my AI** and **Use as plain list**.
2. Click **Format with my AI**. **Expect**: a copyable instruction containing your list, the
   format ([contracts/format-instruction.md](./contracts/format-instruction.md)) and a box to
   paste the answer.
3. Paste the instruction into your AI assistant, then paste its answer back. **Expect**: a
   preview of 4 options with descriptions and categories. Edit one title and remove nothing.
4. Paste an answer that has one title removed. **Expect**: the error
   "options[2].title: missing" and a **Copy correction for AI** button.
5. Click **Create project** and sign in with Google. **Expect**: the consent screen asks only for
   "files you use with this app". A Sheet named after the project appears in your Drive.
6. Grade 3 options and comment on one. Open **Stats**, sort by average grade and group by
   category. **Expect**: correct averages and groups.
7. Reload and open **My projects**. **Expect**: the project is listed with its data intact.
- Covered by `apps/web/e2e/us1-create.spec.ts`, `packages/core/test/format/*` (including the
  answers fixture set for SC-002) and `packages/store-google-sheets/test/contract.test.ts`.

### US2: Share and collaborate

1. Owner: click **Share → Anyone with the link can contribute → Copy link**. Optionally set a
   password.
2. Collaborator (second profile): open the link. **Expect**: Google sign-in, then one Picker
   confirmation (or the fallback flow from research R21), then the project. If a password is set,
   a password prompt comes first.
3. Collaborator: grade 2 options and comment once. **Expect**: within 30 s, the owner sees the
   updated averages and the comment with the collaborator's name, without reloading.
4. Owner: switch the link to **view**. Collaborator: reload. **Expect**: grading and commenting
   are disabled, with an explanation.
5. Password mode: open the Sheet in Google Sheets. **Expect**: payload cells are `enc:v1:…` and
   no option titles are readable (SC-007).
6. Simulate quota exhaustion (dev toolbar → "force 429"). **Expect**: "syncing paused, retrying in
   N s". Grades queue up and sync afterwards, with nothing lost.
- Covered by `apps/web/e2e/us2-share.spec.ts` (two browser contexts) and the store contract tests
  (author stamping, password round trip, 429 queue).

### US3: Ranked vote

1. Owner: **Voting → Open (top 3, live results on)**. Owner and collaborator each drag their top 3.
   The collaborator then re-submits a different order. **Expect**: one ballot per person, and
   live points update.
2. Owner: **Close voting**. **Expect**: an outcome card with the winner, the full order with
   points and the tie-break used. History shows round 1.
3. Arrange a tie (two ballots in mirror order). **Expect**: the tie is broken by average grade,
   and the outcome says so.
4. Click **Verify**. **Expect**: "Reproduced ✓" (SC-006).
5. Reopen voting and close it again. **Expect**: round 2 is appended, and round 1 is unchanged.
- Covered by `packages/strategy-borda/test/contract.test.ts` (Borda cases, tie-break chain, RNG
  vectors from [contracts/strategy.md](./contracts/strategy.md)) and `apps/web/e2e/us3-vote.spec.ts`.

## Live Google checklist (manual, before each release)

- [ ] Picker `setFileIds` grants a collaborator access to a link-shared Sheet (or the fallback
  works).
- [ ] The consent screen shows only the `drive.file` scope, and the app is "In production".
- [ ] 20-collaborator soak test for 10 minutes stays under 20 Sheets reads per minute per client,
  with no 429 storms (SC-005).
- [ ] Turning link sharing off blocks the collaborator on the next refresh.

## Done criteria (MVP)

- [ ] All US1–US3 scenarios pass manually and in CI.
- [ ] Axe reports zero WCAG 2.1 AA violations on the project, stats and vote screens.
- [ ] Each of SC-001 to SC-009 has an owning test or a checklist item recorded in `tasks.md`.
