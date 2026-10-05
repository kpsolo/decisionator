# Quickstart & Validation Guide: Decision Engine Core (MVP)

This guide shows the feature working end to end. Each scenario maps to a user story in
[spec.md](./spec.md) and lists the automated test that covers it. Contract details are in
[contracts/](./contracts/), and entity details are in [data-model.md](./data-model.md).

## Prerequisites

- Node.js 24 LTS and pnpm 10 (`corepack enable`)
- For US3 (Google Docs): a Google account. Self-hosters can set their own Google "Desktop app"
  OAuth client in `DECIGINATOR_GOOGLE_CLIENT_ID`.
- For US4: any MCP-capable agent, such as Claude Code or Claude Desktop. If you have none, use
  the scripted test agent `pnpm --filter @deciginator/node test-agent`.
- For US5: Docker (to run a local relay) and a second browser profile (to act as the
  collaborator).

## Setup

```bash
pnpm install
pnpm build
pnpm --filter @deciginator/node start      # prints http://127.0.0.1:4178/?token=…
```

To develop with hot reload, run `pnpm dev`. It starts the node and the Vite UI.

## Automated checks

```bash
pnpm lint && pnpm typecheck
pnpm test                 # unit + integration + contract (Vitest)
pnpm test:contract        # plugin, strategy, idea-source and agentic API contract suites
pnpm test:e2e             # Playwright user-story flows + axe accessibility checks
```

All of these must pass before `/speckit-implement` reports a story done.

## Validation scenarios

### US1: Capture options and decide (P1)

1. Open the launch URL. **Expect**: the empty state offers "New decision". There is no
   settings prompt.
2. Create the decision "Dinner tonight" and add the options Sushi, Pizza and Tacos. **Expect**:
   the options appear in order.
3. Click **Decide → Pick myself → Tacos**. **Expect**: the outcome card shows Tacos,
   "Manual pick", your name and the time.
4. Click **Decide** again and pick Pizza. **Expect**: the history shows two outcomes, and the
   first one is unchanged.
5. Restart the node and reload the page. **Expect**: everything persists.
- Covered by `e2e/us1-decide.spec.ts`. The SC-001 timing (under 60 s) is asserted in the same
  spec.

### US2: Strategy modules (P2)

1. On a decision with 4 options, choose **Random**. **Expect**: the outcome shows its seed.
2. Click **Verify**. **Expect**: "Reproduced ✓".
3. Choose **Weighted** and set one option's weight to 0. Run it 20 times. **Expect**: that
   option is never chosen.
4. In the plugin area, install `examples/plugin-strategy-example` from its folder or `.zip`.
   **Expect**: a permission prompt, then the new strategy appears in the chooser with a
   generated settings panel.
5. Run any 2-option strategy on a 1-option decision. **Expect**: a plain-language reason
   appears and no outcome is recorded.
- Covered by `plugins/*/test/contract.test.ts` (seed vectors in
  [contracts/strategy.md](./contracts/strategy.md)) and `e2e/us2-strategies.spec.ts`.

### US3: Idea sources (P3)

1. Copy this text, then click **Ideas → Import → Clipboard**:
   ```text
   - Sushi — near the office
   - Pizza
   * Tacos: Friday special

   1. Ramen
   ```
   **Expect**: the preview shows 4 ideas, with descriptions split out. Confirm the import.
2. Import the same text again. **Expect**: 0 new ideas, 4 skipped as duplicates.
3. Click **Import → Google Docs** and pick a doc that contains a bulleted list. **Expect**:
   Google's consent screen asks only for "files you select" (`drive.file`), then the preview
   lists the bullets with links back to the doc.
4. Edit the doc to add one bullet, then click **Refresh**. **Expect**: exactly 1 new idea.
5. Select ideas and click **Add to decision**. **Expect**: they become options and keep their
   source links.
- Covered by `plugins/source-clipboard/test/*` and `plugins/source-google-docs/test/*`. The
  Google Docs tests use recorded `documents.get` fixtures, so no live Google calls run in CI.
  Also covered by `e2e/us3-ideas.spec.ts`.

### US4: Ask your own agent (P4)

1. On the option "Tacos", click **Ask my agent**, enter "Find opening hours and reviews", and
   choose the local channel. **Expect**: a copyable agent brief containing the MCP URL, the
   token, the rules and the expiry.
2. Give the brief to your agent, or run
   `pnpm --filter @deciginator/node test-agent --brief <file>`. **Expect**: within seconds a
   contribution with sources appears on Tacos, labeled with the agent's name, "for <you>" and
   **Pending review**.
3. Click **Accept** on one contribution and **Dismiss** on another. **Expect**: the statuses
   update, and the dismissed one is hidden but still present in history.
4. Have the agent call `add_contribution` targeting a different option. **Expect**: `403`, and
   an audit entry is visible to you.
5. Click **Revoke**, then let the agent call `get_context`. **Expect**: `401 REVOKED`.
- Covered by `packages/node/test/contract/agentic-api.*` (MCP and REST) and
  `e2e/us4-agent.spec.ts`.

### US5: Share and vote (P5)

1. Start a relay with `docker compose -f packages/relay/compose.yaml up` (it listens on
   `http://localhost:8787`). In **Settings → Sharing**, set the relay URL.
2. Owner: click **Share → Contribute access → Copy invite**. Collaborator (second profile,
   second node on port 4179): open the invite. The owner confirms the request. **Expect**: the
   collaborator sees the decision.
3. The collaborator adds a note. **Expect**: the owner sees it, attributed to the collaborator.
4. The owner selects **Plurality vote** and sets ballots to anonymous. Both participants vote,
   and the collaborator then changes their vote. The owner clicks **Decide**. **Expect**: one
   ballot is counted per person, and the collaborator cannot see who voted for what.
5. On the relay host, inspect the SQLite file. **Expect**: no plaintext option titles.
6. The owner revokes the collaborator. **Expect**: the collaborator's next sync is refused and
   their UI shows "access revoked".
- Covered by `packages/relay/test/*`, `packages/core/test/crypto/*` and
  `e2e/us5-share.spec.ts` (two nodes and one relay).

### US6: Plugin customization (P6)

1. Open **Plugins**. **Expect**: every built-in plugin is listed with its type, version,
   permissions and an enable toggle.
2. Install `examples/plugin-source-example`. **Expect**: the permission review lists its `net:`
   hosts.
3. Change one of its settings. **Expect**: the generated form validates the input, and the
   plugin's behavior changes.
4. Install `examples/plugin-incompatible` (built for runtime `^2.0.0`). **Expect**: it is
   refused with an explanation.
5. Enable `examples/plugin-hang`, which never responds. **Expect**: an error toast names the
   plugin, and US1's flow still works.
- Covered by `e2e/us6-plugins.spec.ts` and `packages/ui/test/plugin-host/*`.

## Done criteria

- Every scenario above passes, both manually and in CI.
- `pnpm test:e2e` includes axe checks with zero WCAG 2.1 AA violations on the primary screens.
- The success criteria SC-001 to SC-009 in [spec.md](./spec.md) have an owning test or a manual
  check recorded in `tasks.md`.
