import { type Page, expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/** Feature 005, User Stories 5 and 6: time tooltips and resets (local store, owner). */

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

test("grade times, a re-grade and a reset show in tooltips; resets keep outcomes", async ({
  page,
}) => {
  await createProject(page);
  const lisbon = card(page, "Lisbon");

  await test.step("a re-grade keeps the earlier value and both times", async () => {
    await lisbon.locator('input[aria-label="3 stars"]').check({ force: true });
    await expect(lisbon.getByText("3.0 avg · 1 rating")).toBeVisible();
    await lisbon.locator('input[aria-label="4 stars"]').check({ force: true });
    await expect(lisbon.getByText("4.0 avg · 1 rating")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
    // The text is also available without hovering, for screen readers.
    const stars = lisbon.getByRole("group", { name: "Your rating for Lisbon" });
    const describedBy = await stars.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = page.locator(`[id="${describedBy}"]`);
    await expect(description).toContainText("You rated 4 ·");
    await expect(description).toContainText("Changed from 3 at");
  });

  await test.step("hovering the average shows the last rating time", async () => {
    await lisbon.getByText("4.0 avg · 1 rating").hover();
    // The visible tooltip is decorative (aria-hidden); screen readers use aria-describedby.
    await expect(page.locator("[data-radix-popper-content-wrapper]")).toContainText(
      "Last rating ·"
    );
  });

  await test.step("a ballot and an outcome before the reset", async () => {
    await page.getByRole("link", { name: "Vote" }).click();
    await page.getByRole("button", { name: "Submit Ballot" }).click();
    await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();
    await page.getByRole("button", { name: "Close Voting & Tally Results" }).click();
    await expect(page.getByText(/Voting is CLOSED/)).toBeVisible({ timeout: 10000 });
    await page.getByRole("link", { name: "Project", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
  });

  await test.step("the owner resets all votes after a confirmation", async () => {
    await page.getByRole("button", { name: "More project actions" }).click();
    await page.getByRole("menuitem", { name: "Reset…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Clear 1 grade and 1 ballot from everyone?")).toBeVisible();
    await checkA11y(page, "Reset dialog");
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(lisbon.getByText("No ratings yet")).toBeVisible({ timeout: 10000 });
    const stars = lisbon.getByRole("group", { name: "Your rating for Lisbon" });
    const describedBy = await stars.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${describedBy}"]`)).toContainText("Reset by you ·");
  });

  await test.step("the outcome recorded before the reset still verifies", async () => {
    await page.getByRole("link", { name: "Results" }).click();
    await page.getByRole("button", { name: "Verify Outcome" }).first().click();
    await expect(page.getByText("Reproduced ✓")).toBeVisible({ timeout: 10000 });
  });
});

test("'Mark all as not seen' resets only the viewer's own marks", async ({ page }) => {
  await createProject(page);
  await page.evaluate(() => {
    const key = "decisionator_installed_plugins";
    const plugins = JSON.parse(localStorage.getItem(key) ?? "[]");
    for (const p of plugins) {
      if (p.id === "org.decisionator.option-status") p.settings = { autoMark: true, seconds: 1 };
    }
    localStorage.setItem(key, JSON.stringify(plugins));
  });
  await page.reload();
  await expect(page.locator("[data-option-marker]")).toHaveCount(0, { timeout: 8000 });

  await page.getByRole("button", { name: "Mark all as not seen" }).click();
  const confirm = page.getByRole("dialog");
  await expect(
    confirm.getByText("Show every option as new again? Only your own marks change.")
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Mark all as not seen" }).click();
  await expect(page.getByText("3 not seen yet")).toBeVisible();
  // They stay new for the rest of this visit even though they are on screen.
  await page.waitForTimeout(2500);
  await expect(page.locator("[data-option-marker]")).toHaveCount(3);
});
