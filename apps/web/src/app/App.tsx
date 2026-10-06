import { QuotaBudget } from "@decisionator/store-google-sheets";
import { Blocks, Home, Menu, Plus, Settings, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useRoutes } from "react-router-dom";
import { DeciIcon } from "../components/DeciLogo.js";
import { ThemeProvider } from "../components/theme-provider.js";
import { ThemeToggle } from "../components/theme-toggle.js";
import { Button } from "../components/ui/button.js";
import { Toaster } from "../components/ui/toaster.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { DevToolbar } from "../dev/DevToolbar.js";
import { LiveIndicator } from "../features/live/LiveIndicator.js";
import { LiveSessionDialog } from "../features/live/LiveSessionDialog.js";
import { LiveShareProvider } from "../features/live/LiveShareContext.js";
import { cn } from "../lib/utils.js";
import { SyncBanner } from "../sync/SyncBanner.js";
import { routes } from "./routes.js";
import "./theme.css";

const appBudget = new QuotaBudget();

const sidebarNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors pointer-coarse:min-h-11",
    "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    isActive
      ? "bg-accent text-accent-foreground font-semibold shadow-xs"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
  );

export function AppShell() {
  const routeElements = useRoutes(routes);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row bg-background font-sans text-foreground selection:bg-primary/20">
      {/* A button, not an #anchor: hash routing would treat the fragment as a route. */}
      <button
        type="button"
        onClick={() => document.getElementById("main-content")?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </button>

      {/* Mobile Top Bar (< md screens) */}
      <header className="sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md md:hidden">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-md text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DeciIcon
            size={28}
            className="shadow-[0_2px_8px_-2px_rgba(11,132,254,0.35)] rounded-[8px]"
          />
          <span className="text-base font-bold tracking-tight">Deci</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <LiveIndicator />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in-0 duration-200 cursor-default border-0"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer Menu */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-card p-5 border-r border-border flex flex-col justify-between md:hidden shadow-raised transition-transform duration-200 ease-in-out",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Mobile Navigation"
      >
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-md text-foreground"
            >
              <DeciIcon
                size={32}
                className="shadow-[0_2px_8px_-2px_rgba(11,132,254,0.35)] rounded-[9px]"
              />
              <span className="text-base font-bold tracking-tight">Deci</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <Button asChild className="w-full justify-start gap-2.5 h-10 shadow-sm font-medium">
            <Link to="/new" onClick={() => setMobileMenuOpen(false)}>
              <Plus className="h-4 w-4" aria-hidden />
              <span>New project</span>
            </Link>
          </Button>

          <nav aria-label="Mobile Navigation" className="flex flex-col gap-1">
            <NavLink
              to="/"
              end
              className={sidebarNavLinkClass}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Home className="h-4 w-4" aria-hidden />
              <span>Projects</span>
            </NavLink>
            <NavLink
              to="/plugins"
              className={sidebarNavLinkClass}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Blocks className="h-4 w-4" aria-hidden />
              <span>Plugins</span>
            </NavLink>
            <NavLink
              to="/settings"
              className={sidebarNavLinkClass}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Settings className="h-4 w-4" aria-hidden />
              <span>Settings</span>
            </NavLink>
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-border/60">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">Live session</span>
            <LiveIndicator />
          </div>
          <div className="flex items-center justify-between px-1 pt-2 border-t border-border/40">
            <span className="text-xs font-medium text-muted-foreground">Appearance</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Desktop Left Sidebar (>= md screens) */}
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col justify-between border-r border-border bg-card/40 backdrop-blur-sm p-5 sticky top-0 h-dvh overflow-y-auto"
        aria-label="Main Navigation"
      >
        <div className="space-y-5">
          <Link
            to="/"
            className="flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-accent/50 transition-colors ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <DeciIcon
              size={34}
              className="shadow-[0_2px_8px_-2px_rgba(11,132,254,0.35)] rounded-[10px] shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-foreground leading-none">
                Deci
              </span>
              <span className="text-[11px] font-medium text-muted-foreground mt-0.5">
                Decision Engine
              </span>
            </div>
          </Link>

          <Button asChild className="w-full justify-start gap-2.5 h-10 shadow-sm font-medium">
            <Link to="/new">
              <Plus className="h-4 w-4" aria-hidden />
              <span>New project</span>
            </Link>
          </Button>

          <nav aria-label="Desktop Navigation" className="flex flex-col gap-1">
            <NavLink to="/" end className={sidebarNavLinkClass}>
              <Home className="h-4 w-4" aria-hidden />
              <span>Projects</span>
            </NavLink>
            <NavLink to="/plugins" className={sidebarNavLinkClass}>
              <Blocks className="h-4 w-4" aria-hidden />
              <span>Plugins</span>
            </NavLink>
            <NavLink to="/settings" className={sidebarNavLinkClass}>
              <Settings className="h-4 w-4" aria-hidden />
              <span>Settings</span>
            </NavLink>
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-border/70">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">Live session</span>
            <LiveIndicator />
          </div>
          <div className="flex items-center justify-between px-2 pt-2 border-t border-border/40">
            <span className="text-xs font-medium text-muted-foreground">Appearance</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex flex-1 flex-col min-w-0 min-h-dvh">
        <SyncBanner budget={appBudget} />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8"
        >
          {routeElements}
        </main>
      </div>

      <DevToolbar budget={appBudget} />
      <LiveSessionDialog />
      <Toaster />
    </div>
  );
}

/** Root component; expects to be rendered inside a router (see main.tsx). */
export function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="decisionator-theme">
      <TooltipProvider delayDuration={300}>
        <LiveShareProvider>
          <AppShell />
        </LiveShareProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
