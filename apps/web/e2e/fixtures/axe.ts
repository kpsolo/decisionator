import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function checkA11y(page: Page, contextName = "page") {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  if (accessibilityScanResults.violations.length > 0) {
    const violationsDesc = accessibilityScanResults.violations
      .map(
        (v: (typeof accessibilityScanResults.violations)[number]) =>
          `[${v.id}] ${v.help} (${v.nodes.length} nodes):\n${v.nodes.map((n) => `  - ${n.target.join(" ")}: ${n.failureSummary}`).join("\n")}`
      )
      .join("\n");
    throw new Error(`Accessibility violations found in ${contextName}:\n${violationsDesc}`);
  }
}
