import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App.js";
import { installDevPlugins } from "./features/option-view/dev-plugins.js";

// Example option plugins listed in localStorage "deci.devPlugins"; dropped from production builds.
if (import.meta.env.DEV) installDevPlugins();

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <HashRouter>
        <Routes>
          <Route path="/*" element={<App />} />
        </Routes>
      </HashRouter>
    </React.StrictMode>
  );
}
