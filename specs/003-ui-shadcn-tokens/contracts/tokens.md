# Contract: Design Token System

**Contract Version**: `1.2.0`  
**Target Module**: `@decisionator/web` (`src/app/theme.css` & Tailwind configuration)  

---

## 1. Overview

The Design Token System establishes the single source of truth for all visual values (colors, spacing, typography, radii, shadows, and z-index elevation) across the Decisionator application. All views and components MUST read styles exclusively through these tokens.

---

## 2. Token Registry & Semantic Roles

| Token Name | Category | Semantic Purpose | Light Value (HSL) | Dark Value (HSL) | Minimum Contrast |
|------------|----------|------------------|-------------------|------------------|------------------|
| `--background` | Color | Base page backdrop | `240 5% 98%` | `240 10% 3.9%` | Base |
| `--foreground` | Color | Default high-contrast body text | `240 10% 3.9%` | `0 0% 98%` | > 10:1 vs `--background` |
| `--card` | Color | Container surface for options, forms (raised above `--background`) | `0 0% 100%` | `240 6% 7%` | Surface |
| `--card-foreground` | Color | Text inside card containers | `240 10% 3.9%` | `0 0% 98%` | > 10:1 vs `--card` |
| `--popover` | Color | Floating menus, dropdowns, tooltips, dialogs | `0 0% 100%` | `240 6% 8%` | Overlay |
| `--popover-foreground` | Color | Text inside popovers | `240 10% 3.9%` | `0 0% 98%` | > 10:1 vs `--popover` |
| `--primary` | Color | Primary actions, CTA buttons, active state | `221.2 83.2% 50%` | `217.2 91.2% 59.8%` | > 4.5:1 (also on 10% tints) |
| `--primary-foreground`| Color | Text and icons on primary backgrounds | `210 40% 98%` | `222.2 47.4% 11.2%` | > 4.5:1 vs `--primary` |
| `--secondary` | Color | Secondary buttons, subtle pills | `240 4.8% 94%` | `240 3.7% 15.9%` | Subtle |
| `--secondary-foreground` | Color | Text on secondary elements | `240 5.9% 10%` | `0 0% 98%` | > 7:1 vs `--secondary` |
| `--muted` | Color | Inactive tabs, disabled backgrounds | `240 4.8% 94%` | `240 3.7% 15.9%` | Low contrast |
| `--muted-foreground` | Color | Helper text, secondary timestamps | `240 5% 40%` | `240 5% 64.9%` | > 4.5:1 vs `--background`, `--card`, `--muted` |
| `--accent` | Color | Hover highlights, active selection | `240 4.8% 94%` | `240 3.7% 15.9%` | Interactive |
| `--accent-foreground` | Color | Text on accent surfaces | `240 5.9% 10%` | `0 0% 98%` | > 7:1 vs `--accent` |
| `--destructive` | Color | Destructive actions (delete, reset); also used as text | `0 72.2% 44%` | `0 84% 60%` | > 4.5:1 as text on `--card` and on its 10% tint |
| `--destructive-foreground` | Color | Text on destructive surfaces | `0 0% 100%` | `0 0% 7%` | > 4.5:1 vs `--destructive` |
| `--warning` | Color | Warnings, unsaved changes, notices; also used as text | `26 90% 33%` | `38 92% 50%` | > 4.5:1 as text on `--card` and on its 10% tint |
| `--warning-foreground` | Color | Text on warning surfaces | `0 0% 100%` | `26 83% 14%` | > 4.5:1 vs `--warning` |
| `--success` | Color | Success toasts, verified votes, checks; also used as text | `142 72% 26%` | `142.1 70.6% 45.3%` | > 4.5:1 as text on `--card` and on its 10% tint |
| `--success-foreground` | Color | Text on success surfaces | `0 0% 100%` | `144 61% 10%` | > 4.5:1 vs `--success` |
| `--rating` | Color | Star/score glyphs | `32 95% 44%` | `43 96% 56%` | > 3:1 vs `--card` (non-text) |
| `--border` | Color | Structural element outlines | `240 5.9% 90%` | `240 3.7% 15.9%` | Boundary |
| `--input` | Color | Form input borders | `240 5.9% 84%` | `240 4% 24%` | Focusable |
| `--ring` | Color | Focus ring for keyboard accessibility | `221.2 83.2% 50%` | `217.2 91.2% 59.8%` | > 3:1 focus ring |
| `--radius` | Radius | Default component corner rounding | `0.625rem` (`10px`) | `0.625rem` (`10px`) | Shape |
| `--agent` | Color | Principle IV: AI Agent identifier badge/accent; also used as text | `262.1 83.3% 57.8%` | `263 85% 74%` | > 4.5:1 as text on `--card` and `--agent-muted` |
| `--agent-foreground` | Color | Text on agent background surfaces | `210 40% 98%` | `263 50% 12%` | > 4.5:1 vs `--agent` |
| `--agent-muted` | Color | Subtle agent suggestion card tint | `262.1 83.3% 96%` | `263.4 40% 16%` | Tint |
| `--agent-border` | Color | Border for agent-contributed cards | `262.1 83.3% 85%` | `263.4 50% 30%` | Boundary |

---

| `--elevation-card` / `--elevation-raised` | Shadow | Resting card / floating surface elevation (`shadow-card`, `shadow-raised`) | soft zinc-tinted | deeper black | — |

> **1.1.0**: Light `--destructive`, `--success`, `--warning` and dark `--destructive`, `--agent` failed WCAG AA as text in 1.0.0 (3.6, 3.3, 2.1, 2.0, 2.8:1). They were adjusted and the pairs are now asserted in `apps/web/test/theme-tokens.test.ts`. Added `--rating`, `--warning-foreground`, `--success-foreground` and elevation tokens. Light semantic colors are dark enough that `text-X` stays ≥ 4.5:1 on the `bg-X/10` alert-panel tint.

> **1.2.0**: Every `--*-foreground` for a semantic role (`primary`, `destructive`, `success`, `warning`, `agent`) is white (`0 0% 100%`) in both themes. Filled surfaces that carry that text use new `--*-solid` tokens (`bg-primary-solid`, …): light `--primary-solid` `221.2 83.2% 50%`, `--destructive-solid` `0 72.2% 44%`, `--success-solid` `142 72% 26%`, `--warning-solid` `26 90% 33%`, `--agent-solid` `262.1 83.3% 57.8%`; dark `221.2 83.2% 53.3%`, `0 72.2% 50.6%`, `142 72% 29%`, `26 90% 37%`, `262.1 83.3% 57.8%`. The base role colours stay for text, `bg-X/10` tints, borders and rings: in dark mode one colour cannot be both readable as text on dark surfaces and dark enough under white text. White on each `-solid` (also at 90% hover opacity) is ≥ 4.5:1, asserted in `apps/web/test/theme-tokens.test.ts`.

## 3. Tailwind Mapping Schema

All tokens are bound into Tailwind utilities:
- `bg-background`, `bg-card`, `bg-secondary`, `bg-muted`, `bg-accent`
- Solid fills under white text: `bg-primary-solid`, `bg-destructive-solid`, `bg-success-solid`, `bg-warning-solid`, `bg-agent-solid` (hover `/90`)
- Tints: `bg-primary/10`, `bg-destructive/10`, `bg-agent/15` …
- `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `text-agent`
- `border-border`, `border-input`, `border-primary`, `border-agent-border`
- `ring-ring`, `ring-agent`
- `text-rating`, `fill-rating`, `shadow-card`, `shadow-raised`
- `dark:` variant is bound to the `.dark` class on `<html>` via `@custom-variant dark (&:where(.dark, .dark *))`
- `rounded-lg` (`var(--radius)`), `rounded-md` (`calc(var(--radius) - 2px)`), `rounded-sm` (`calc(var(--radius) - 4px)`)

---

## 4. Compliance & Invariants

1. **No Hardcoded Hex or RGB literals**: Component JSX and CSS MUST NOT use hardcoded colors (`#2563eb`, `rgb(...)`). All styling MUST reference semantic token utilities or `var(--token)`.
2. **WCAG 2.1 AA Verification**: Normal text vs background contrast must exceed 4.5:1. Large text and UI components must exceed 3:1.
3. **Motion Safety**: Transitions must be wrapped with `@media (prefers-reduced-motion: reduce)` rules or Tailwind `motion-reduce:*` utilities.
