import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export interface ThemeProviderState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}

// Storage access throws in some private modes and sandboxed iframes; theming must still work.
function readStoredTheme(storageKey: string): Theme | null {
  try {
    const stored = localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(storageKey: string, theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Preference just won't persist across sessions.
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Swaps the root class with transitions suppressed so surfaces don't animate mid-switch. */
function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (root.classList.contains(resolved) && root.style.colorScheme === resolved) return;

  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;

  // Force a style flush before re-enabling transitions.
  window.getComputedStyle(root).getPropertyValue("color");
  requestAnimationFrame(() => style.remove());
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "decisionator-theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(storageKey) ?? defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === "system" ? systemTheme() : theme
  );

  useEffect(() => {
    const resolve = (resolved: ResolvedTheme) => {
      applyResolvedTheme(resolved);
      setResolvedTheme(resolved);
    };

    if (theme !== "system") {
      resolve(theme);
      return;
    }

    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = () => resolve(mediaQuery.matches ? "dark" : "light");
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      writeStoredTheme(storageKey, next);
      setThemeState(next);
    },
    [storageKey]
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = (): ThemeProviderState => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
