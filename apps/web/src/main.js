import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App.js";
const rootElement = document.getElementById("root");
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(_jsx(React.StrictMode, { children: _jsx(HashRouter, { children: _jsx(Routes, { children: _jsx(Route, { path: "/*", element: _jsx(App, {}) }) }) }) }));
}
//# sourceMappingURL=main.js.map