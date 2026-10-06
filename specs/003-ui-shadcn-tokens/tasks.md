# Implementation Tasks: UI Redesign with Design Tokens and Shadcn UI Architecture

**Feature**: UI Redesign with Design Token System and Reusable Component Architecture  
**Branch**: `003-ui-shadcn-tokens` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize Tailwind styling pipeline, utility dependencies, and configuration.

- [X] T001 Configure Tailwind CSS and CVA dependencies in apps/web/package.json
- [X] T002 Configure Tailwind Vite integration and token mappings in apps/web/vite.config.ts
- [X] T003 [P] Implement cn utility helper using clsx and tailwind-merge in apps/web/src/lib/utils.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core design tokens and fundamental accessible component primitives that MUST be complete before ANY user story view can be rebuilt.

- [X] T004 Define comprehensive semantic design token variables for light and dark themes in apps/web/src/app/theme.css
- [X] T005 [P] Implement ThemeProvider and useTheme hook with localStorage persistence and OS preference sync in apps/web/src/components/theme-provider.tsx
- [X] T006 [P] Implement accessible Button primitive with variants, sizes, and loading state in apps/web/src/components/ui/button.tsx
- [X] T007 [P] Implement accessible Card suite (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter) in apps/web/src/components/ui/card.tsx
- [X] T008 [P] Implement accessible Input and Textarea primitives with error states and focus rings in apps/web/src/components/ui/input.tsx
- [X] T009 [P] Implement accessible Badge primitive with default, secondary, destructive, success, warning, and agent variants in apps/web/src/components/ui/badge.tsx
- [X] T010 [P] Implement Skeleton placeholder loading primitive with pulse animation in apps/web/src/components/ui/skeleton.tsx

**Checkpoint**: Core design tokens and basic UI primitives ready. User story implementation can now proceed.

---

## Phase 3: User Story 1 - Cohesive Visual Appearance and Token-Driven Theming (Priority: P1) 🎯 MVP

**Goal**: Establish the token-driven layout shell and theme switcher so the entire application supports Light, Dark, and System modes with zero unstyled flash.

**Independent Test**: Load the application in a browser, toggle between Light and Dark mode via the header control, and verify all background surfaces, text colors, and borders instantly update to token values.

- [X] T011 [P] [US1] Create ThemeToggle component with Sun, Moon, and Monitor icons in apps/web/src/components/theme-toggle.tsx
- [X] T012 [US1] Wrap application root shell with ThemeProvider in apps/web/src/app/App.tsx
- [X] T013 [P] [US1] Rebuild application navigation header with brand icon, theme toggle, and responsive container in apps/web/src/app/pages.tsx
- [X] T014 [US1] Verify theme switching performance and token contrast compliance in apps/web/test/theme-tokens.test.ts

**Checkpoint**: At this point, User Story 1 is functional as an MVP. The token baseline and theme switching are fully operational.

---

## Phase 4: User Story 2 - Consistent & Accessible Core Workspace and Decision Flows (Priority: P1)

**Goal**: Rebuild the primary decision creation, grading, and voting flows using standardized Shadcn UI primitives, sortable option cards, and skeleton loaders.

**Independent Test**: Create a project via the wizard, view options in the workspace, submit grades and votes, and observe consistent token-driven styling and keyboard accessibility throughout.

- [X] T015 [P] [US2] Rebuild HomePage with skeleton loading states, drag-and-drop dropzone, and token-styled project cards in apps/web/src/app/HomePage.tsx
- [X] T016 [P] [US2] Rebuild New Project Wizard stepper and Paste step with token-styled textarea in apps/web/src/features/paste-format/PasteStep.tsx
- [X] T017 [P] [US2] Rebuild Wizard Format step and Preview editor with token-styled tables and option editor in apps/web/src/features/paste-format/FormatStep.tsx
- [X] T018 [US2] Implement accessible Tabs primitive suite (Tabs, TabsList, TabsTrigger, TabsContent) in apps/web/src/components/ui/tabs.tsx
- [X] T019 [US2] Rebuild ProjectViewPage workspace layout with tabs, header action controls, and responsive grid in apps/web/src/app/ProjectViewPage.tsx
- [X] T020 [P] [US2] Rebuild Option Grading and Option Detail components with token-styled sliders and score badges in apps/web/src/features/grading/GradeInput.tsx
- [X] T021 [P] [US2] Rebuild Strategy Chooser and Voting Controls with token-based cards and voting pills in apps/web/src/features/decide/StrategyChooser.tsx
- [X] T022 [P] [US2] Rebuild Rank Ballot and Results View with accessible sortable handles and deterministic outcome badges in apps/web/src/features/voting/RankBallot.tsx
- [X] T023 [P] [US2] Rebuild Comment Thread with token-styled avatars, input cards, and timestamps in apps/web/src/features/comments/CommentThread.tsx

**Checkpoint**: Both User Story 1 and User Story 2 are fully integrated and operable.

---

## Phase 5: User Story 3 - Unified Modal Dialogs, Menus, and Feedback Notifications (Priority: P2)

**Goal**: Standardize all modals, overlay menus, and feedback notifications with backdrop blur, focus trapping, and toast alerts.

**Independent Test**: Open the Share dialog, copy a link, observe toast appearance and auto-dismissal, and verify Escape key dismisses modals cleanly.

- [X] T024 [P] [US3] Implement accessible Dialog primitive suite (Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose) in apps/web/src/components/ui/dialog.tsx
- [X] T025 [P] [US3] Implement accessible DropdownMenu primitive suite in apps/web/src/components/ui/dropdown-menu.tsx
- [X] T026 [P] [US3] Implement accessible Tooltip primitive suite in apps/web/src/components/ui/tooltip.tsx
- [X] T027 [P] [US3] Implement Toast notification provider, toaster container, and useToast hook in apps/web/src/components/ui/toast.tsx
- [X] T028 [US3] Mount Toaster notification container in the root app shell in apps/web/src/app/App.tsx
- [X] T029 [P] [US3] Rebuild ShareDialog and InPageShareModal with dialog primitives, copy-link toast, and QR code rendering in apps/web/src/features/sharing/ShareDialog.tsx
- [X] T030 [P] [US3] Rebuild Password Setup, Password Prompt, and Join Flow modals with token-styled form inputs in apps/web/src/features/sharing/PasswordSetup.tsx
- [X] T031 [P] [US3] Rebuild Storage Settings modal and Project Move/Delete dialogs with token-styled cards and destructive buttons in apps/web/src/features/settings/StorageSettings.tsx
- [X] T032 [P] [US3] Rebuild Plugin Settings and Plugins Page with token-styled toggles and parameter forms in apps/web/src/features/plugins/PluginsPage.tsx

**Checkpoint**: All modal dialogs, menus, and notification toasts are standardized across secondary flows.

---

## Phase 6: User Story 4 - High-Clarity Agent Collaboration & Attribution Indicators (Priority: P2)

**Goal**: Implement unmistakable visual differentiation for AI agent findings and reviews complying with Constitution Principle IV.

**Independent Test**: View a project with agent contributions, verifying that agent-generated ideas, enrichments, and reviews display distinct violet `--agent` tokens, badges, and metadata.

- [X] T033 [P] [US4] Create AgentAttributionBadge component displaying agent name, timestamp, and confidence pill using --agent tokens in apps/web/src/components/agent-attribution-badge.tsx
- [X] T034 [P] [US4] Rebuild AgentBrief configuration panel with token-styled textarea and parameter badges in apps/web/src/features/agents/AgentBrief.tsx
- [X] T035 [P] [US4] Rebuild ConnectAgent dialog with token-styled status indicators and permission scopes in apps/web/src/features/agents/ConnectAgent.tsx
- [X] T036 [US4] Rebuild ContributionReview with side-by-side comparison, accept/dismiss buttons, and agent attribution badge in apps/web/src/features/agents/ContributionReview.tsx

**Checkpoint**: Agent contributions are visually distinct and fully compliant with Principle IV.

---

## Phase 7: User Story 5 - Responsive Mobile, Tablet, and Desktop Adaptability (Priority: P3)

**Goal**: Optimize ergonomics, touch target sizes, and layout flexibility for mobile and tablet devices.

**Independent Test**: Test on 360px viewport width, confirm minimum 44x44px touch targets, zero horizontal scrolling, and accessible mobile controls.

- [X] T037 [P] [US5] Implement mobile bottom-sheet styling in DialogContent for screen widths under 640px in apps/web/src/components/ui/dialog.tsx
- [X] T038 [P] [US5] Implement responsive sticky mobile action bar for voting and decision triggers in apps/web/src/features/voting/VotingControls.tsx
- [X] T039 [US5] Audit and enforce minimum 44x44px touch target sizes on all interactive buttons and icon controls in apps/web/src/components/ui/button.tsx

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Refinements affecting multiple views and final quality gates.

- [X] T040 [P] Implement Separator and Switch accessible primitives in apps/web/src/components/ui/separator.tsx
- [X] T041 [P] Rebuild SyncBanner and DevToolbar with token-based status styling in apps/web/src/sync/SyncBanner.tsx
- [X] T042 Rebuild ProjectUnavailable fallback screen with token-styled empty state in apps/web/src/features/project/ProjectUnavailable.tsx
- [X] T043 Run automated accessibility audit with axe-core across all routes and dialogs in apps/web/e2e/a11y.spec.ts
- [X] T044 Run quickstart validation scenarios from specs/003-ui-shadcn-tokens/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - starts immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS** all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. Delivers the core theming MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational and User Story 1 completion.
- **User Story 3 (Phase 5)**: Depends on User Story 2 completion.
- **User Story 4 (Phase 6)**: Depends on User Story 2 completion. Can proceed in parallel with US3.
- **User Story 5 (Phase 7)**: Depends on US2 and US3 completion.
- **Polish (Phase 8)**: Depends on all user stories completion.

### Parallel Opportunities

- Within Phase 1: `T003` can run in parallel.
- Within Phase 2: `T005`, `T006`, `T007`, `T008`, `T009`, `T010` can run in parallel once `T004` token variables are defined.
- Within Phase 3 (US1): `T011` and `T013` can run in parallel.
- Within Phase 4 (US2): `T015`, `T016`, `T017`, `T020`, `T021`, `T022`, `T023` can run in parallel across separate feature directories.
- Within Phase 5 (US3): `T024`, `T025`, `T026`, `T027`, `T029`, `T030`, `T031`, `T032` can run in parallel.
- Within Phase 6 (US4): `T033`, `T034`, `T035` can run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1)
1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1 - Theming & Token shell).
3. Validate theme toggle and zero FOUC immediately.

### Incremental Feature Delivery
1. Foundation & MVP: Setup + Foundational + US1 -> Deliver baseline theme engine.
2. Core Decision Engine UX: Add US2 -> Deliver fully modernized decision creation and voting workspace.
3. Overlays & Secondary Actions: Add US3 -> Deliver standardized modals, storage settings, and toasts.
4. Agent Collaboration: Add US4 -> Deliver Principle IV agent attribution indicators.
5. Mobile & Polish: Add US5 + Phase 8 -> Finalize mobile touch ergonomics and run automated WCAG 2.1 AA audits.
