import type { Option } from "@decisionator/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterableOptionList } from "./FilterableOptionList.js";

const sampleOptions: Option[] = [
  {
    id: "opt_1",
    title: "Reykjavik Offsite",
    description: "Hot springs and aurora",
    status: "active",
    category: "Nordic",
    tags: ["Nature", "Adventure"],
    pros: [],
    cons: [],
    links: [],
  },
  {
    id: "opt_2",
    title: "Kyoto Retreat",
    description: "Temples and gardens",
    status: "active",
    category: "Asia",
    tags: ["Culture", "Food"],
    pros: [],
    cons: [],
    links: [],
  },
  {
    id: "opt_3",
    title: "Madeira Workshop",
    description: "Hikes and direct flights",
    status: "active",
    category: "Europe",
    tags: ["Hiking"],
    pros: [],
    cons: [],
    links: [],
  },
];

describe("FilterableOptionList component", () => {
  it("renders options and search input when options count > 2", () => {
    const html = renderToStaticMarkup(
      <FilterableOptionList
        options={sampleOptions}
        renderOption={(opt) => <li key={opt.id}>{opt.title}</li>}
      />
    );

    expect(html).toContain('aria-label="Search options"');
    expect(html).toContain('placeholder="Search options..."');
    expect(html).toContain("Reykjavik Offsite");
    expect(html).toContain("Kyoto Retreat");
    expect(html).toContain("Madeira Workshop");
  });

  it("omits search input when options count <= 2", () => {
    const html = renderToStaticMarkup(
      <FilterableOptionList
        options={sampleOptions.slice(0, 2)}
        renderOption={(opt) => <li key={opt.id}>{opt.title}</li>}
      />
    );

    expect(html).not.toContain('aria-label="Search options"');
    expect(html).toContain("Reykjavik Offsite");
    expect(html).toContain("Kyoto Retreat");
  });

  it("renders sorting dropdown and includes 'My unrated first' when myGrades is provided", () => {
    const grades = new Map([["opt_1", 5]]);
    const html = renderToStaticMarkup(
      <FilterableOptionList
        options={sampleOptions}
        myGrades={grades}
        renderOption={(opt) => <li key={opt.id}>{opt.title}</li>}
      />
    );

    expect(html).toContain('aria-label="Sort options"');
    expect(html).toContain("Original order");
    expect(html).toContain("Highest rated");
    expect(html).toContain("My unrated first");
    expect(html).toContain("Most discussed");
    expect(html).toContain("Title (A–Z)");
  });
});
