import AxeBuilder from "@axe-core/playwright";
export async function checkA11y(page, contextName = "page") {
    const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
    if (accessibilityScanResults.violations.length > 0) {
        const violationsDesc = accessibilityScanResults.violations
            .map((v) => `[${v.id}] ${v.help} (${v.nodes.length} nodes)`)
            .join("\n");
        throw new Error(`Accessibility violations found in ${contextName}:\n${violationsDesc}`);
    }
}
//# sourceMappingURL=axe.js.map