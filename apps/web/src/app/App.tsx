import React, { useEffect, useState } from "react";
import { HashRouter, Link, useRoutes } from "react-router-dom";
import { DevToolbar } from "../dev/DevToolbar.js";
import { SyncBanner } from "../sync/SyncBanner.js";
import { routes } from "./routes.js";
import "./theme.css";

export function AppShell() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("decisionator-theme") as "light" | "dark") || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("decisionator-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  const routeElements = useRoutes(routes);

  return (
    <div className="app-container">
      <header className="header">
        <Link to="/" className="header-brand">
          <span>⚖️</span>
          <span>Decisionator</span>
        </Link>
        <nav className="header-nav">
          <Link to="/new" className="btn btn-outline">
            + New
          </Link>
          <Link to="/settings" className="btn btn-outline">
            Settings
          </Link>
          <Link to="/plugins" className="btn btn-outline">
            Plugins
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-outline"
            aria-label="Toggle theme"
          >
            {theme === "light" ? "🌙 Dark" : "☀️ Light"}
          </button>
        </nav>
      </header>
      <SyncBanner />
      <main className="main-content">{routeElements}</main>
      <DevToolbar />
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

export default AppShell;
