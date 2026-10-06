# Quickstart Validation Guide: UI Redesign with Design Tokens

**Feature**: UI Redesign with Design Token System and Reusable Component Architecture  
**Branch**: `003-ui-shadcn-tokens`  

---

## Prerequisites

- Node.js 22+ / 24 LTS and pnpm 10+ installed
- Chromium-based browser (Chrome, Edge, or Brave) for manual visual check
- Dependencies installed via `pnpm install`

---

## Setup Commands

1. **Verify workspace and run build**:
   ```bash
   pnpm --filter @decisionator/web typecheck
   pnpm --filter @decisionator/web build
   ```

2. **Launch development server**:
   ```bash
   pnpm --filter @decisionator/web dev
   ```
   Navigate to `http://localhost:5173/decisionator/`.

---

## Validation Scenarios

### Scenario 1: Theme Switching and Zero Unstyled Flash
1. Open the application at `http://localhost:5173/decisionator/`.
2. Locate the Theme Toggle in the header (Sun/Moon/Monitor icon).
3. Switch between **Light**, **Dark**, and **System** modes.
4. **Expected Outcome**:
   - Background, card surfaces, borders, text, and buttons instantly transition to matching tokens (<100ms).
   - No hardcoded colors remain static (no un-themed white cards on dark backgrounds).
   - Reloading the page retains the user's selected theme from `localStorage`.

### Scenario 2: End-to-End Decision Creation with Shadcn Primitives
1. Click **+ New Decision Project** on the Home page.
2. In the New Project Wizard:
   - Paste a sample list of options (e.g. "Paris\nTokyo\nNew York").
   - Click **Next: Format**. Verify the clean input preview and options table.
   - Click **Create Project**.
3. **Expected Outcome**:
   - Form inputs, step navigation, and buttons use consistent Shadcn tokens.
   - Transitions are smooth, and focus indicators highlight correctly on keyboard navigation (`Tab`).

### Scenario 3: Modals, Toasts, and Feedback UX
1. In an open decision project, click **Share**.
2. Click **Copy Share Link**.
3. **Expected Outcome**:
   - The Share dialog opens with smooth backdrop blur and focus trapped inside.
   - An ephemeral **Toast notification** appears ("Share link copied to clipboard") and auto-dismisses after 4 seconds.
   - Pressing `Escape` cleanly dismisses the dialog.

### Scenario 4: AI Agent Attribution Indicator (Constitution Principle IV)
1. Open a decision project containing agent contributions or attach a simulated agent finding.
2. Inspect the agent-generated idea or comment.
3. **Expected Outcome**:
   - Agent content renders with the distinct purple/indigo `--agent` token styling.
   - A visible `<Badge variant="agent">` is present showing agent origin and attribution, visually distinct from human contributions.

### Scenario 5: Accessibility & WCAG 2.1 AA Audit
1. Run Playwright accessibility tests:
   ```bash
   pnpm --filter @decisionator/web test:e2e
   ```
2. **Expected Outcome**:
   - Axe-core accessibility checks report 0 violations across all scanned routes and modals.
   - Contrast ratio meets or exceeds 4.5:1 for body copy and 3:1 for UI elements.
