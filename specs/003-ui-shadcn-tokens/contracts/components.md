# Contract: UI Component Primitives & UX Standards

**Contract Version**: `1.0.0`  
**Target Module**: `@decisionator/web` (`src/components/ui/*`)  

---

## 1. Overview

Defines the required component primitives, API interfaces, accessibility specifications, and interaction states for Decisionator's rebuilt UI.

---

## 2. Component Catalog & Interfaces

### 2.1 Button (`src/components/ui/button.tsx`)
- **Props**:
  ```typescript
  export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
      VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
  }
  ```
- **Variants**:
  - `default`: High-emphasis solid button (`bg-primary-solid text-primary-foreground hover:bg-primary-solid/90`)
  - `destructive`: Irreversible actions like project deletion (`bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90`)
  - `outline`: Secondary actions with explicit border (`border border-input bg-background hover:bg-accent hover:text-accent-foreground`)
  - `secondary`: Subdued background actions (`bg-secondary text-secondary-foreground hover:bg-secondary/80`)
  - `ghost`: Transparent button for toolbars and icons (`hover:bg-accent hover:text-accent-foreground`)
  - `link`: Inline text link styling with underline on hover (`text-primary underline-offset-4 hover:underline`)
  - `agent`: Agent-specific action trigger (`bg-agent-solid text-agent-foreground hover:bg-agent-solid/90`)
- **Sizes**: `default` (h-10 px-4 py-2), `sm` (h-9 rounded-md px-3), `lg` (h-11 rounded-md px-8), `icon` (h-10 w-10).
- **Accessibility**:
  - `aria-busy="true"` and `disabled` when `isLoading={true}`
  - Focus indicator: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
  - Minimum touch target dimension of 44x44px on mobile viewports.

### 2.2 Input & Textarea (`src/components/ui/input.tsx`, `textarea.tsx`)
- **Props**: Standard HTML input/textarea attributes + `hasError?: boolean` + `helperText?: string`.
- **States**: Default (`border-input`), Focus (`ring-2 ring-ring border-transparent`), Error (`border-destructive ring-destructive`), Disabled (`opacity-50 cursor-not-allowed`).

### 2.3 Card Suite (`src/components/ui/card.tsx`)
- **Components**: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
- **Styling**: `rounded-lg border border-border bg-card text-card-foreground shadow-sm`.
- **Interactive Variant**: `Card variant="interactive"` adds hover shadow and border transition for clickable project tiles.

### 2.4 Dialog Suite (`src/components/ui/dialog.tsx`)
- **Components**: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`.
- **Accessibility & UX**:
  - Backdrop blur with `bg-black/50 backdrop-blur-sm data-[state=open]:animate-in`.
  - Content centered on desktop, rendered as accessible bottom-sheet or full-width sheet on mobile (<640px).
  - Built-in `X` close button in top-right with `sr-only` label.
  - Automatic focus trap and Esc key dismissal via Radix primitive.

### 2.5 Badge (`src/components/ui/badge.tsx`)
- **Variants**: `default`, `secondary`, `destructive`, `outline`, `success`, `warning`, `agent`.
- **Agent Variant**: `bg-agent/15 text-agent border border-agent-border font-medium flex items-center gap-1`.

### 2.6 DropdownMenu (`src/components/ui/dropdown-menu.tsx`)
- **Components**: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`.
- **Keyboard Navigation**: Full arrow-up/down navigation, Enter/Space selection, Escape dismissal.

### 2.7 Tabs (`src/components/ui/tabs.tsx`)
- **Components**: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.
- **UX**: Pill-style segmented control with active animated background and keyboard arrow-key navigation.

### 2.8 Skeleton (`src/components/ui/skeleton.tsx`)
- **Styling**: `animate-pulse rounded-md bg-muted`.
- **Usage**: Used in `HomePage` and `ProjectViewPage` during data hydration to prevent layout shift.

### 2.9 Tooltip (`src/components/ui/tooltip.tsx`)
- **Components**: `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent`.
- **Behavior**: Appears on hover/focus after 300ms delay with `bg-popover text-popover-foreground text-xs shadow-md border border-border px-2.5 py-1.5 rounded-md`.

### 2.10 Toast & Toaster (`src/components/ui/toast.tsx`)
- **Capabilities**: Success, Error, Warning, Info feedback with auto-dismiss (4000ms), manual swipe-to-dismiss, and action button support.

---

## 3. UX Guidelines for Flows

1. **New Project Wizard**:
   - Multi-step progress bar at top (Paste -> Format -> Preview).
   - Sticky navigation footer with "Back" and "Next: Preview Options".
2. **Project View Workspace**:
   - Header with title, storage badge (Local File / Cloud), active role, and share button.
   - Tabs for "Options & Grading", "Voting & Ballot", "Results", "Agent Findings", "Comments".
   - Sortable options with distinct drag handle, voting pill, and expansion toggle for details.
3. **Attribution Display**:
   - All agent-generated suggestions must feature the `Badge variant="agent"` with robot/sparkle icon and tooltip indicating invocation timestamp and model.
