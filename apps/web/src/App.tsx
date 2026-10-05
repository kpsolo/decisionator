import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import PickerSpike from "./spikes/PickerSpike.js";

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
            <h1>Deci</h1>
            <p>Modular decision-making engine</p>
            <nav style={{ marginTop: "1rem" }}>
              <Link to="/spike/picker">→ T032 Google Picker Spike Tool</Link>
            </nav>
          </main>
        }
      />
      <Route path="/spike/picker" element={<PickerSpike />} />
    </Routes>
  );
}
