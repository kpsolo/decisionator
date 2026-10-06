import { QuotaBudget } from "@decisionator/store-google-sheets";
import { Blocks, Plus, Scale, Settings } from "lucide-react";
import { Link, NavLink, useRoutes } from "react-router-dom";
import { ThemeProvider } from "../components/theme-provider.js";
import { ThemeToggle } from "../components/theme-toggle.js";
import { Button } from "../components/ui/button.js";
import { Toaster } from "../components/ui/toaster.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { DevToolbar } from "../dev/DevToolbar.js";
import { cn } from "../lib/utils.js";
import { SyncBanner } from "../sync/SyncBanner.js";
import { routes } from "./routes.js";
import "./theme.css";

const appBudget = new QuotaBudget();

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 justify-center",
    "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    isActive
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground"
  );

export function AppShell() {
  const routeElements = useRoutes(routes);

  return (
    <div className="flex min-h-dvh flex-col bg-background font-sans text-foreground selection:bg-primary/20">
      {/* A button, not an #anchor: hash routing would treat the fragment as a route. */}
      <button
        type="button"
        onClick={() => document.getElementById("main-content")?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </button>
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-md text-foreground pointer-coarse:min-h-11 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground shadow-card">
              <Scale className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-base font-semibold tracking-tight">Deci</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-1.5">
            <NavLink to="/settings" className={navLinkClass} aria-label="Settings">
              <Settings className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Settings</span>
            </NavLink>
            <NavLink to="/plugins" className={navLinkClass} aria-label="Plugins">
              <Blocks className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Plugins</span>
            </NavLink>
            <ThemeToggle />
            <Button size="sm" asChild className="ml-1">
              <Link to="/new">
                <Plus className="h-4 w-4" aria-hidden />
                <span>
                  New <span className="max-sm:sr-only">project</span>
                </span>
              </Link>
            </Button>
          </nav>
        </div>
      </header>
      <SyncBanner budget={appBudget} />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8"
      >
        {routeElements}
      </main>
      <DevToolbar budget={appBudget} />
      <Toaster />
    </div>
  );
}

/** Root component; expects to be rendered inside a router (see main.tsx). */
export function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="decisionator-theme">
      <TooltipProvider delayDuration={300}>
        <AppShell />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
