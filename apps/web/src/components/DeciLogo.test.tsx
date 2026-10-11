import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeciIcon } from "./DeciLogo.js";

describe("DeciIcon", () => {
  it("renders badge variant with unique gradient IDs across multiple instances", () => {
    const html = renderToStaticMarkup(
      <div>
        <DeciIcon variant="badge" />
        <DeciIcon variant="badge" />
      </div>
    );

    const gradMatches = Array.from(html.matchAll(/id="(deci-badge-bg-[^"]+)"/g)).map((m) => m[1]);
    expect(gradMatches.length).toBe(2);
    // IDs must be distinct
    expect(gradMatches[0]).not.toBe(gradMatches[1]);

    const fillMatches = Array.from(html.matchAll(/fill="url\(#(deci-badge-bg-[^"]+)\)"/g)).map(
      (m) => m[1]
    );
    expect(fillMatches.length).toBe(2);
    expect(fillMatches[0]).toBe(gradMatches[0]);
    expect(fillMatches[1]).toBe(gradMatches[1]);
  });

  it("renders glyph variant with unique gradient IDs", () => {
    const html = renderToStaticMarkup(
      <div>
        <DeciIcon variant="glyph" />
        <DeciIcon variant="glyph" />
      </div>
    );

    const gradMatches = Array.from(html.matchAll(/id="(deci-glyph-grad-[^"]+)"/g)).map((m) => m[1]);
    expect(gradMatches.length).toBe(2);
    expect(gradMatches[0]).not.toBe(gradMatches[1]);

    const fillMatches = Array.from(html.matchAll(/fill="url\(#(deci-glyph-grad-[^"]+)\)"/g)).map(
      (m) => m[1]
    );
    expect(fillMatches.length).toBe(2);
    expect(fillMatches[0]).toBe(gradMatches[0]);
    expect(fillMatches[1]).toBe(gradMatches[1]);
  });

  it("renders monochrome variant without gradients", () => {
    const html = renderToStaticMarkup(<DeciIcon variant="monochrome" />);
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toContain("linearGradient");
  });
});
