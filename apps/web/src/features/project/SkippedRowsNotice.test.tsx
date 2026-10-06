import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkippedRowsNotice } from "./SkippedRowsNotice.js";

describe("SkippedRowsNotice", () => {
  it("renders nothing when no row was skipped", () => {
    expect(renderToStaticMarkup(<SkippedRowsNotice />)).toBe("");
    expect(renderToStaticMarkup(<SkippedRowsNotice warnings={[]} />)).toBe("");
  });

  it("names every skipped row", () => {
    const html = renderToStaticMarkup(
      <SkippedRowsNotice
        warnings={[
          "grades row 7: invalid JSON payload (Unexpected token)",
          "options row 3: validation failed (Required)",
        ]}
      />
    );
    expect(html).toContain('aria-label="Entries that could not be read"');
    expect(html).toContain("2 stored entries could not be read");
    expect(html).toContain("grades row 7: invalid JSON payload (Unexpected token)");
    expect(html).toContain("options row 3: validation failed (Required)");
  });

  it("uses the singular for one skipped row", () => {
    const html = renderToStaticMarkup(<SkippedRowsNotice warnings={["meta row 6: bad"]} />);
    expect(html).toContain("1 stored entry could not be read");
  });
});
