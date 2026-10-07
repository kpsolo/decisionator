# End-to-End Tests & Accessibility Audit (Axe)

This directory contains Playwright end-to-end integration and accessibility suites covering User Stories 1 through 3 and WCAG 2.1 AA conformance (FR-082).

## Suites Overview

- **`us1-create.spec.ts`**:
  - Validates pasting, AI format round trip, preview editing, and draft preservation.
  - Project creation in Google Drive, option grading (1–5), commenting with Markdown, and project deletion flow with confirmation.
  - Automated Axe accessibility scan across New Project, Project Detail, Stats, and Delete Confirmation dialogs.
- **`us2-share.spec.ts`**:
  - Two-context browser collaboration verifying multi-user live sync, role permissions (owner vs contribute vs view), and Google Picker fallback.
  - Password setup (12+ characters) and 5-attempt lockout security.
  - Quota exhaustion backoff banner and forced 429 offline queue resilience.
  - Automated Axe accessibility scan across Share Dialog, Password Setup, and Password Prompt modal.
- **`us3-vote.spec.ts`**:
  - Ranked voting using keyboard accessible and drag-and-drop ballot reordering.
  - Resubmission/ballot replacement semantics.
  - Voting round closure and deterministic Borda tally execution.
  - Verification button re-running tally on recorded seed and inputs.
  - Reopening rounds (Round 1 → Round 2).
  - Automated Axe accessibility scan across Ballot Ranking and Results screens.

- **`local-flow.spec.ts`**: full lifecycle on the default local store (create, grade, comment, vote, decide, live session, export, delete).
- **`export-restore.spec.ts`** (local store):
  - Paste ideas as a plain list, grade some options, comment, rank a ballot.
  - View the ranking (Borda), change the ranking system (grade-weighted draw) and view the new ranking; the latest outcome stays in force after a reload.
  - Export JSON and Excel (`.xlsx`) and check their contents; delete the project.
  - Upload each file on the home page and check the restored project: grades, comment, ballot, both outcomes, and *Verify Outcome* reproduces the restored outcome.
  - A file that is not a project export is rejected.

## Accessibility Audit (WCAG 2.1 AA)

Each user story E2E suite runs `@axe-core/playwright` audits across all MVP dialogs, interactive controls, and views:
- **Violations**: 0 WCAG 2.1 AA violations.
- **Form Controls & ARIA**:
  - Radio groups and rating controls use accessible `<input type="radio">` and `<fieldset>` with legends.
  - Dynamic status messages and sync counters use semantic `<output aria-live="polite">`.
  - Color contrast ratios exceed the 4.5:1 minimum threshold across all themes.
  - All interactive elements support full keyboard navigation (Enter / Space / Arrows / Tab).

## Running Tests

```bash
# Run Playwright E2E suites
pnpm --filter @decisionator/web test:e2e
```
