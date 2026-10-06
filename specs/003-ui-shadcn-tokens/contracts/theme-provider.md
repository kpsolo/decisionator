# Contract: Theme Provider & Mode Switching

**Contract Version**: `1.0.0`  
**Target Module**: `@decisionator/web` (`src/components/theme-provider.tsx`)  

---

## 1. Overview

The Theme Provider manages active visual theme state across the application, coordinating user selection, system OS color preferences, persistence in `localStorage`, and runtime DOM class synchronization.

---

## 2. Interface Contract

```typescript
export type Theme = "dark" | "light" | "system";

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export interface ThemeProviderState {
  theme: Theme;
  resolvedTheme: "dark" | "light";
  setTheme: (theme: Theme) => void;
}

export const useTheme = (): ThemeProviderState => {
  // returns active ThemeProviderState
};
```

---

## 3. Protocol & Execution Flow

1. **Storage Key**: Default storage key is `decisionator-theme`.
2. **Initial Resolution**:
   - Check `localStorage.getItem(storageKey)`.
   - If value is `"light"` or `"dark"`, apply immediately.
   - If value is `"system"` or `null`:
     - Query `window.matchMedia("(prefers-color-scheme: dark)").matches`.
     - Set resolved theme to `"dark"` if true, otherwise `"light"`.
3. **DOM Application**:
   - Target root: `document.documentElement` (`<html>` element).
   - If resolved theme is `"dark"`: add class `"dark"`, set `style.colorScheme = "dark"`.
   - If resolved theme is `"light"`: remove class `"dark"`, set `style.colorScheme = "light"`.
4. **Listener**:
   - Register change listener on `matchMedia("(prefers-color-scheme: dark)")` when theme is set to `"system"`.
   - Clean up listener on unmount or when theme changes to an explicit mode.
5. **Transitions**:
   - Ensure theme switch applies without CSS transition hitch by temporarily suppressing transitions if necessary, or using instantaneous variable swap.
