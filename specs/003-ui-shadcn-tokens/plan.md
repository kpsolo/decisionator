# Implementation Plan: UI Redesign with Design Tokens and Shadcn UI Component Architecture

**Branch**: `003-ui-shadcn-tokens` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-ui-shadcn-tokens/spec.md` with user guidance: *"ui should have best ux as pissble"*

---

## Summary

This feature rebuilds Decisionator's entire user interface to establish an accessible, modern, token-driven architecture using Tailwind CSS, CSS Custom Properties, and Shadcn UI component primitives (built on Radix UI). 

Key deliverables:
1. **Design Token Foundation**: Full semantic token palette (`--background`, `--foreground`, `--primary`, `--card`, `--popover`, `--muted`, `--accent`, `--destructive`, `--ring`, `--radius`, plus Principle IV `--agent` attribution tokens) supporting Light, Dark, and System theme modes with persistent local preferences.
2. **Accessible Component Primitives**: A centralized suite of typed components in `apps/web/src/components/ui/` (`Button`, `Input`, `Textarea`, `Card`, `Badge`, `Dialog`, `DropdownMenu`, `Tabs`, `Toast`, `Tooltip`, `Skeleton`, `Switch`, `Separator`) utilizing `@radix-ui` primitives and `class-variance-authority` (cva).
3. **Comprehensive UI & UX Rebuild**: Modernization of all application views (`HomePage`, New Project Wizard, `ProjectViewPage`, Option Grading, Voting, Results, Sharing, Settings, Plugins, and Agent Reviews) with responsive mobile layouts, smooth state transitions, skeleton loading, and toast notifications.
4. **WCAG 2.1 AA Compliance & Keyboard Navigation**: 100% accessible navigation, visible focus rings, ARIA roles, and high-contrast compliance verified through automated testing.

---

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict ESM). React 19, Vite 6. Target runtime: Evergreen modern browsers (Chrome, Edge, Firefox, Safari).

**Primary Dependencies**:
- Styling: Tailwind CSS, CSS Custom Properties (HSL/OKLCH).
- UI Primitives: `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-toast`, `@radix-ui/react-tooltip`.
- Utilities: `clsx`, `tailwind-merge`, `class-variance-authority` (cva), `lucide-react`.
- Markdown & Sanitization: `markdown-it`, `dompurify`.
- Drag & Drop: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.

**Storage**:
- Theme preference persisted in browser `localStorage` (`decisionator-theme`).
- Project storage remains managed by existing `StorageManager` (`store-file`, `store-firestore`, `store-google-sheets`, `store-local`).

**Testing**:
- Unit & Component tests: Vitest 3.
- End-to-End & Accessibility: Playwright + `@axe-core/playwright`.

**Target Platform**: Browser Single Page Application (SPA), responsive from mobile (320px) to desktop (1920px+).

**Performance Goals**:
- Sub-100ms theme switching without screen flash or layout shift.
- First Contentful Paint (FCP) < 1.0s, Cumulative Layout Shift (CLS) < 0.05.

**Constraints**:
- Must comply with Constitution Principle I (core untouched), Principle III (simple primary flow), Principle IV (distinct agent attribution), Principle V (zero telemetry or tracking), and Plugin/Accessibility constraints (WCAG 2.1 AA).
- All visual attributes must read from tokens (zero hardcoded hex or RGB strings in components).

**Scale/Scope**: Complete visual and interaction modernization of all 18+ application screens, modals, and toolbars.

---

## Constitution Check

*GATE: Evaluated before Phase 0 research and re-checked after Phase 1 design.*

| Principle / Constraint | Pre-Research Evaluation | Post-Design Evaluation | Status |
|------------------------|-------------------------|------------------------|:------:|
| **I. Minimal Core, Everything Is a Module** | Changes are strictly limited to `apps/web`. Core domain packages and schemas are not modified. | Confirmed: only `apps/web/src` components and styles are modified. | **PASS** |
| **II. Stable, Versioned Contracts** | Contracts for tokens, component interfaces, and theme provider are versioned (v1.0.0). Existing store/strategy contracts intact. | Contracts documented in `contracts/tokens.md`, `components.md`, `theme-provider.md`. | **PASS** |
| **III. Simple by Default, Deep on Demand** | Rebuild streamlines the primary flow (Paste -> Preview -> Decide -> Share) into clean steps; advanced configurations live in dialogs/tabs. | Stepper wizard and clean workspace tabs deliver high-clarity UX without clutter. | **PASS** |
| **IV. Agent-Native by Design** | Design token system introduces dedicated `--agent` tokens and `<Badge variant="agent">` for visual distinction. | Specified in `tokens.md` and `components.md` with unmistakable violet accent. | **PASS** |
| **V. User Owns the Data** | No third-party styles, remote CDNs, fonts, or analytics added. All assets bundled locally. | Fully self-contained local build; zero external runtime calls. | **PASS** |
| **VI. Transparent, Reproducible Decisions** | Verification badges and deterministic outcome metadata styled prominently. | Visual badges highlight reproducible seeds and verified ballots. | **PASS** |
| **VII. Test-First for Contracts & Strategies** | Testing includes automated accessibility audits (`@axe-core/playwright`) and token coverage. | Component tests and a11y test scenarios added to `quickstart.md`. | **PASS** |
| **Accessibility Constraint: WCAG 2.1 AA** | High-contrast token pairs, keyboard focus rings, and Radix ARIA primitives satisfy WCAG 2.1 AA. | Verified contrast ratios (>4.5:1 text, >3:1 UI) documented in tokens contract. | **PASS** |

---

## Project Structure

### Documentation (this feature)

```text
specs/003-ui-shadcn-tokens/
├── spec.md              # Feature specification
├── plan.md              # Implementation plan (this file)
├── research.md          # Phase 0 technical research
├── data-model.md        # Phase 1 data model & state machines
├── quickstart.md        # Phase 1 validation scenarios
├── contracts/           # Phase 1 interface contracts
│   ├── tokens.md        # Design token schema & CSS custom properties
│   ├── components.md    # UI component primitives & UX specifications
│   └── theme-provider.md# Theme provider contract & lifecycle
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code (repository root)

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── theme.css             # Semantic token definitions (:root, .dark)
│   │   ├── App.tsx               # App shell with ThemeProvider & Toaster
│   │   ├── HomePage.tsx          # Redesigned Home page with skeleton & cards
│   │   ├── ProjectViewPage.tsx   # Redesigned workspace with tabs & sticky action bar
│   │   └── routes.tsx            # Navigation routes
│   ├── components/
│   │   ├── theme-provider.tsx    # ThemeProvider context (light/dark/system)
│   │   ├── theme-toggle.tsx      # Theme toggle button component
│   │   └── ui/                   # Reusable Shadcn UI primitives
│   │       ├── button.tsx        # CVA Button with variants & loading state
│   │       ├── input.tsx         # Styled input with error states
│   │       ├── textarea.tsx      # Styled textarea
│   │       ├── card.tsx          # Card, CardHeader, CardContent, CardFooter
│   │       ├── badge.tsx         # Badge with agent variant
│   │       ├── dialog.tsx        # Radix Dialog with backdrop blur
│   │       ├── dropdown-menu.tsx # Radix DropdownMenu
│   │       ├── tabs.tsx          # Radix Tabs
│   │       ├── tooltip.tsx       # Radix Tooltip
│   │       ├── toast.tsx         # Toast notification provider & hook
│   │       ├── skeleton.tsx      # Pulse placeholder skeleton
│   │       ├── switch.tsx        # Accessible toggle switch
│   │       └── separator.tsx     # Clean divider line
│   ├── features/
│   │   ├── paste-format/         # Stepper wizard: Paste, Format, Preview
│   │   ├── grading/              # Option grading cards & modal details
│   │   ├── voting/               # Drag-and-drop ballot & results cards
│   │   ├── sharing/              # Share dialogs & QR code modals
│   │   ├── agents/               # Agent brief & contribution review with agent tokens
│   │   ├── settings/             # Storage settings panel
│   │   └── plugins/              # Plugin catalog & settings
│   └── lib/
│       └── utils.ts              # cn() helper (clsx + tailwind-merge)
└── tailwind.config.ts            # Tailwind token mappings
```

---

## Complexity Tracking

*No constitution violations or deferred principles. All quality gates passed.*
