import { type Page, expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/** Feature 005, User Stories 7 and 8: the project's decision method and strategy comparison. */

async function createProject(page: Page) {
  await page.goto("./");
  await page.getByRole("link", { name: "+ New Decision Project" }).click();
  await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(
    JSON.stringify({
      format: "decisionator.options/v1",
      project: { title: "Friday lunch" },
      options: [{ title: "Ramen" }, { title: "Tacos" }, { title: "Salad bar" }],
    })
  );
  await page.getByRole("button", { name: /^Use 3 options$/ }).click();
  await page.getByRole("button", { name: "Create Project →" }).click();
  await expect(page.getByRole("heading", { name: "Friday lunch" })).toBeVisible({ timeout: 15000 });
  return page.url();
}

test("the owner chooses the method; closing the vote uses it or stays open", async ({ page }) => {
  const projectUrl = await createProject(page);
  await page.getByRole("link", { name: "Vote" }).click();
  await expect(page.getByTestId("decided-by")).toContainText("Decided by: Borda Count Ranking");

  await test.step("choose weighted grades", async () => {
    await page.getByLabel("Method").selectOption({ label: "Random Weighted by Grades" });
    await page.getByRole("button", { name: "Save method" }).click();
    await expect(page.getByTestId("decided-by")).toContainText(
      "Decided by: Random Weighted by Grades"
    );
  });

  await test.step("without grades the vote stays open with the reason", async () => {
    await page.getByRole("button", { name: "Close Voting & Tally Results" }).click();
    await expect(page.getByText("Voting stays open", { exact: true })).toBeVisible();
    await expect(page.getByText(/Voting is OPEN/)).toBeVisible();
  });

  await test.step("with grades the outcome is recorded with the chosen method", async () => {
    await page.goto(projectUrl);
    await page.locator('input[aria-label="5 stars"]').first().check({ force: true });
    await expect(page.getByText("5.0 avg · 1 rating")).toBeVisible();
    await page.getByRole("link", { name: "Vote" }).click();
    await page.getByRole("button", { name: "Close Voting & Tally Results" }).click();
    await expect(page.getByText(/Voting is CLOSED/)).toBeVisible({ timeout: 10000 });
    await page.getByRole("link", { name: "Results" }).click();
    await expect(page.getByText("Random Weighted by Grades").first()).toBeVisible();
  });
});

test("changing the method after people voted asks first", async ({ page }) => {
  await createProject(page);
  await page.getByRole("link", { name: "Vote" }).click();
  await page.getByRole("button", { name: "Submit Ballot" }).click();
  await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();

  await page.getByLabel("Method").selectOption({ label: "Uniform Random Draw" });
  await page.getByRole("button", { name: "Save method" }).click();
  await expect(
    page.getByText("1 person has already voted. Changing the method now may change the result.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Change anyway" }).click();
  await expect(page.getByTestId("decided-by")).toContainText("Decided by: Uniform Random Draw");
});

test("compare strategies: same draw on reopen, adopt records an outcome", async ({ page }) => {
  await createProject(page);
  await page.getByRole("link", { name: "Vote" }).click();
  await page.getByRole("button", { name: "Submit Ballot" }).click();
  await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();
  await page.getByRole("link", { name: "Results" }).click();

  await page.getByRole("button", { name: "Compare strategies" }).click();
  const dialog = page.getByRole("dialog");
  const table = dialog.getByRole("table", { name: "Strategy comparison" });
  await expect(table.getByRole("rowheader")).toHaveCount(4);
  const randomRow = table.getByRole("row").filter({ hasText: "Uniform Random Draw" });
  const firstSeed = await randomRow.getByRole("cell").nth(2).textContent();
  expect(firstSeed).toMatch(/^[0-9a-f]{32}$/);
  await checkA11y(page, "Compare strategies dialog");
  await dialog.getByRole("button", { name: "Close" }).last().click();

  await page.getByRole("button", { name: "Compare strategies" }).click();
  await expect(randomRow.getByRole("cell").nth(2)).toHaveText(firstSeed ?? "");

  await dialog.getByRole("button", { name: "Adopt the Borda Count Ranking result" }).click();
  await expect(
    dialog.getByText("Adopted the Borda Count Ranking result as a new outcome.")
  ).toBeVisible();
});
