import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import PickerSpike from "./spikes/PickerSpike.js";
export default function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsxs("main", { style: { padding: "2rem", fontFamily: "sans-serif" }, children: [_jsx("h1", { children: "Deci" }), _jsx("p", { children: "Modular decision-making engine" }), _jsx("nav", { style: { marginTop: "1rem" }, children: _jsx(Link, { to: "/spike/picker", children: "\u2192 T032 Google Picker Spike Tool" }) })] }) }), _jsx(Route, { path: "/spike/picker", element: _jsx(PickerSpike, {}) })] }));
}
//# sourceMappingURL=App.js.map