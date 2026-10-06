# Phase 0 Technical Research: UI Redesign with Design Tokens & Shadcn UI

**Feature**: UI Redesign with Design Token System and Reusable Component Architecture  
**Branch**: `003-ui-shadcn-tokens`  
**Status**: Completed  

---

## 1. Design Token Architecture & CSS Variable System

### Decision
Implement a centralized semantic design token system using CSS Custom Properties (`:root` for light mode, `.dark` for dark mode) structured according to the Shadcn UI token specification, augmented with Decisionator-specific tokens for Agent attribution and decision status.

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --warning: 38 92% 50%;
  --warning-foreground: 48 96% 89%;
  --success: 142.1 76.2% 36.3%;
  --success-foreground: 355.7 100% 97.3%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 221.2 83.2% 53.3%;
  --radius: 0.5rem;

  /* Decisionator Domain Tokens: Principle IV Agent Native Attribution */
  --agent: 262.1 83.3% 57.8%;
  --agent-foreground: 210 40% 98%;
  --agent-muted: 262.1 83.3% 95%;
  --agent-border: 262.1 83.3% 85%;
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 217.2 91.2% 59.8%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --warning: 38 92% 50%;
  --warning-foreground: 48 96% 89%;
  --success: 142.1 70.6% 45.3%;
  --success-foreground: 144 61% 95%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 217.2 91.2% 59.8%;

  /* Decisionator Domain Tokens: Agent Attribution in Dark Mode */
  --agent: 263.4 70% 50.4%;
  --agent-foreground: 210 40% 98%;
  --agent-muted: 263.4 40% 16%;
  --agent-border: 263.4 50% 30%;
}
```

### Rationale
- Pure HSL / OKLCH CSS variables enable seamless opacity modifiers in Tailwind (`bg-primary/20`, `text-muted-foreground/80`).
- Runtime theming requires zero bundle reload or re-renders: simply updating a class on `document.documentElement` (`class="dark"`) cascades across all components instantly (<16ms).
- Provides distinct agent tokens required by Constitution Principle IV so agent suggestions have visual contrast and clear attribution.

### Alternatives Considered
- Hardcoded utility classes with `dark:` prefix: Rejected because it does not support centralized token customization and scatters styling logic across JSX.
- CSS-in-JS (Emotion/Styled Components): Rejected due to React 19 performance overhead and lack of static compile advantages.

---

## 2. Component Primitive Architecture & Radix UI Integration

### Decision
Implement standardized accessible primitives in `apps/web/src/components/ui/` using `@radix-ui` unstyled accessible primitives and `class-variance-authority` (cva) + `clsx` + `tailwind-merge` (`cn` helper):
- `Button` (variants: default, destructive, outline, secondary, ghost, link, agent; sizes: default, sm, lg, icon; with loading spinner state)
- `Input` & `Textarea` (with error state and focus ring)
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- `Badge` (variants: default, secondary, destructive, outline, success, warning, agent)
- `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`
- `DropdownMenu` (with keyboard navigation and item indicators)
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`
- `Toast` / `Toaster` notification provider
- `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`
- `Skeleton` (for high-polish loading states)
- `Switch` & `Checkbox`
- `Separator`

### Rationale
- Radix UI is already partly installed in `apps/web/package.json` (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-toast`).
- Radix handles keyboard focus traps, WAI-ARIA roles, Escape key handling, and focus return automatically, satisfying WCAG 2.1 AA.
- CVA guarantees typed component props (`variant="outline" size="sm"`) and clean style overrides.

### Alternatives Considered
- Material UI (MUI): Too opinionated, heavy bundle size (~300kb), conflicts with Tailwind styling.
- Headless UI: Limited component range compared to Radix.

---

## 3. Best-in-Class UX Enhancements (User Guidance & Ergonomics)

### Decision
Incorporate modern UX patterns across all major flows:
1. **Zero-Friction Decision Wizard**:
   - Visual Step Indicator (1. Input -> 2. Format & Parse -> 3. Preview & Refine) with progress indicators.
   - Live character and line counts, instant parsing preview, clear error callouts with remediation suggestions.
2. **Interactive Decision Workspace**:
   - Option cards with clean drag-handles, prominent badges, and vote counters.
   - Drag-and-drop file import on Home page with clear drag-over hover animation and file format validation.
   - Inline feedback for votes (optimistic updates with subtle checkmark animations).
3. **Skeleton Loading States**:
   - Replace generic "Loading your projects..." text with animated skeleton cards matching the exact layout of project tiles.
4. **Toast Feedback**:
   - Ephemeral toasts for actions: "Link copied to clipboard", "Project exported as JSON", "Peer connected", "Ballot submitted".
5. **Mobile Ergonomics**:
   - Sticky bottom action bar on mobile screens for primary actions ("Cast Vote", "Decide", "Add Option").
   - Minimum 44x44px touch targets on buttons and icon controls.
   - Responsive dialogs that render as bottom sheets on viewports < 640px.

### Rationale
Directly fulfills the user requirement: *"ui should have best ux as pissble"*. Transforming raw HTML forms and basic CSS cards into responsive, animated, feedback-rich surfaces elevates user delight and task completion speed.

---

## 4. Theme Management & Contrast Verification

### Decision
Create a `ThemeProvider` context in `apps/web/src/components/theme-provider.tsx` supporting `"light" | "dark" | "system"` modes, storing user choice in `localStorage`, and listening to `window.matchMedia("(prefers-color-scheme: dark)")` for system changes.

### Rationale
- Zero Flash of Unstyled Content (FOUC) when loading.
- Immediate response to OS dark/light mode toggle.
- Standard WCAG AA contrast ratio compliance (>4.5:1 text, >3:1 UI borders) tested via Playwright axe-core.
