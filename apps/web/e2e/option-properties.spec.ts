import { type Page, expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/** Feature 005, User Stories 3 and 4: plugin-defined properties and option view places. */

const COST = "org.decisionator.examples.option-cost";
const UNREAD_BAR = "org.decisionator.examples.unread-bar";
const PRIORITY_ALT = "org.example.priority-alt";
const BROKEN = "org.example.broken";

async function withDevPlugins(page: Page, ids: string[]) {
  await page.addInitScript((list) => {
    if (!sessionStorage.getItem("deci.e2e.devPlugins")) {
      localStorage.setItem("deci.devPlugins", JSON.stringify(list));
      sessionStorage.setItem("deci.e2e.devPlugins", "1");
    }
  }, ids);
}

async function createProject(page: Page) {
  await page.goto("./");
  await page.getByRole("link", { name: "+ New Decision Project" }).click();
  await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(
    JSON.stringify({
      format: "decisionator.options/v1",
      project: { title: "Team offsite" },
      options: [{ title: "Lisbon" }, { title: "Alps lodge" }, { title: "Barcelona" }],
    })
  );
  await page.getByRole("button", { name: /^Use 3 options$/ }).click();
  await page.getByRole("button", { name: "Create Project →" }).click();
  await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible({ timeout: 15000 });
}

const card = (page: Page, title: string) =>
  page
    .getByRole("list", { name: "Options" })
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });

async function setEnabled(page: Page, id: string, enabled: boolean) {
  await page.evaluate(
    ([pid, on]) => {
      const key = "decisionator_installed_plugins";
      const plugins = JSON.parse(localStorage.getItem(key) ?? "[]");
      for (const p of plugins) if (p.id === pid) p.enabled = on;
      localStorage.setItem(key, JSON.stringify(plugins));
    },
    [id, enabled] as const
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
}

test("a plugin's properties are shown, checked, kept while disabled, and labelled by plugin", async ({
  page,
}) => {
  await withDevPlugins(page, [COST, PRIORITY_ALT]);
  await createProject(page);

  await page.getByRole("button", { name: "Details for Lisbon" }).click();
  const dialog = page.getByRole("dialog");
  const properties = dialog.getByRole("region", { name: "Properties" });
  await expect(properties).toBeVisible();

  await test.step("a wrong type is refused with a message", async () => {
    const cost = properties.getByLabel("Cost per person");
    await cost.fill("abc");
    await cost.press("Enter");
    await expect(properties.getByRole("alert")).toHaveText("Cost per person: enter a number");
  });

  await test.step("a valid value is saved and shown on the card", async () => {
    const cost = properties.getByLabel("Cost per person");
    await cost.fill("420");
    await cost.press("Enter");
    await expect(dialog.getByText("€420").first()).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Budget" })).toBeVisible();
  });

  await test.step("two plugins with the same key are both shown, with their plugin names", async () => {
    await expect(properties.getByLabel("Priority (Option cost)")).toBeVisible();
    await expect(properties.getByLabel(/^Priority \(Priority \(alternative\)\)$/)).toBeVisible();
  });
  await checkA11y(page, "Option detail with plugin properties");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(card(page, "Lisbon").getByText("€420")).toBeVisible();

  await test.step("disabling the plugin hides the value; enabling it shows it again", async () => {
    await setEnabled(page, COST, false);
    await expect(card(page, "Lisbon").getByText("€420")).toHaveCount(0);
    await setEnabled(page, COST, true);
    await expect(card(page, "Lisbon").getByText("€420")).toBeVisible();
  });
});

test("plugins replace the marker, add badges, and cannot break the card", async ({ page }) => {
  await withDevPlugins(page, [UNREAD_BAR, BROKEN]);
  await createProject(page);

  // Two plugins replace the marker; until the person chooses, the first enabled one is used.
  await expect(card(page, "Lisbon").locator('[data-option-marker="dot"]')).toBeVisible();
  await expect(card(page, "Lisbon").getByText("A plugin could not display here.")).toBeVisible();

  await test.step("grading still works next to a failing plugin", async () => {
    await card(page, "Lisbon").locator('input[aria-label="4 stars"]').check({ force: true });
    await expect(card(page, "Lisbon").getByText("4.0 avg · 1 rating")).toBeVisible();
  });

  await test.step("choosing the other marker in Settings switches every card", async () => {
    const projectUrl = page.url();
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByLabel("Marker style").selectOption({ label: "Unread bar" });
    await checkA11y(page, "Settings with option settings");
    await page.goto(projectUrl);
    // The bar is drawn on the card edge; the marker element carries its screen-reader label.
    await expect(card(page, "Lisbon").locator('[data-option-marker="bar"]')).toHaveCount(1);
    await expect(card(page, "Lisbon").locator('[data-option-marker="dot"]')).toHaveCount(0);
  });

  await test.step("disabling the replacing plugin brings back the default dot", async () => {
    await setEnabled(page, UNREAD_BAR, false);
    await expect(card(page, "Lisbon").locator('[data-option-marker="dot"]')).toBeVisible();
  });
});
