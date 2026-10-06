import { expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/**
 * Full decision lifecycle on the default local (on-device) store, with no Google mocks:
 * create from pasted agent JSON → grade → details → comment → stats → vote → results →
 * strategy run → share (live session) → export → delete. The us1–us3 specs cover Google Sheets.
 */

const OPTIONS_JSON = JSON.stringify({
  format: "decisionator.options/v1",
  project: { title: "Team offsite location", description: "Where should we hold the Q1 offsite?" },
  options: [
    {
      title: "Lisbon",
      description: "Mild weather, direct flights.",
      category: "Europe",
      pros: ["Direct flights"],
      cons: ["Hilly"],
    },
    { title: "Alps lodge", description: "Remote and focused.", category: "Europe" },
    { title: "Rent a loft", description: "Cheapest; no travel.", category: "Local" },
    { title: "Barcelona", category: "Europe" },
  ],
});

test("local store: full decision lifecycle", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("./");
  let projectUrl = "";

  await test.step("create a project from pasted options JSON", async () => {
    await page.getByRole("link", { name: "+ New Decision Project" }).click();
    await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(OPTIONS_JSON);
    await page.getByRole("button", { name: /^Use 4 options$/ }).click();
    await expect(page.locator("#project-title-input")).toHaveValue("Team offsite location");
    await page.getByRole("button", { name: "Create Project →" }).click();
    await expect(page.getByRole("heading", { name: "Team offsite location" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(/#\/p\/file\/file_/);
    projectUrl = page.url();
    await checkA11y(page, "Local project view");
  });

  await test.step("grade options, open details, comment; data survives a reload", async () => {
    await page.locator('input[aria-label="5 stars"]').nth(0).check({ force: true });
    await page.locator('input[aria-label="3 stars"]').nth(1).check({ force: true });
    await expect(page.getByText("5.0 avg · 1 rating")).toBeVisible();

    await page.getByRole("button", { name: "Details for Lisbon" }).click();
    await expect(page.getByText("Direct flights", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: /^Comment$/ })
      .first()
      .click();
    await page.getByPlaceholder("Add a comment (Markdown supported)...").fill("Strong pick");
    await page.getByRole("button", { name: "Post Comment" }).click();
    await expect(page.getByRole("button", { name: /^1 comment$/ })).toBeVisible();

    await page.reload();
    await expect(page.getByText("5.0 avg · 1 rating")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /^1 comment$/ })).toBeVisible();

    await page.getByRole("tab", { name: "Statistics & Distributions" }).click();
    await expect(page.getByText("Project Statistics & Distributions")).toBeVisible();
  });

  await test.step("vote page loads the local project and accepts a ballot", async () => {
    await page.goto(projectUrl);
    await page.getByRole("link", { name: "Vote" }).click();
    await expect(page.getByText(/Rank Your Top \d Options/)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Submit Ballot" }).click();
    await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();
    await checkA11y(page, "Local vote page");
  });

  await test.step("results page loads and the owner can run a strategy", async () => {
    await page.goto(projectUrl);
    await page.getByRole("link", { name: "Results" }).click();
    await expect(page.getByRole("heading", { name: "Decision Outcome & Results" })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: /^Decide with / }).click();
    await expect(page.getByText(/Decision executed: Winner is/)).toBeVisible({ timeout: 10000 });
  });

  await test.step("share page offers a live session for a local project", async () => {
    await page.goto(projectUrl);
    await page.getByRole("link", { name: "Share" }).click();
    await expect(page.getByText("This project is stored on this device")).toBeVisible();
    await page.getByRole("button", { name: "Start live session" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "End Session" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  await test.step("export downloads a JSON bundle", async () => {
    await page.goto(projectUrl);
    await page.getByRole("button", { name: "More project actions" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export Project (JSON)" }).click();
    expect((await download).suggestedFilename()).toBe("team-offsite-location-export.json");
  });

  await test.step("delete removes the project from the home list", async () => {
    await page.goto("./");
    await expect(page.getByText("Team offsite location")).toBeVisible({ timeout: 10000 });

    await page.goto(projectUrl);
    await page.getByRole("button", { name: "More project actions" }).click();
    await page.getByRole("menuitem", { name: "Delete Project..." }).click();
    await expect(
      page.getByText("This action will delete the project from this device.")
    ).toBeVisible();
    await page.getByRole("dialog").getByRole("textbox").fill("Team offsite location");
    await page.getByRole("button", { name: "Permanently Delete" }).click();

    await expect(page.getByText("My Decision Projects")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Team offsite location")).toHaveCount(0);
  });

  expect(pageErrors).toEqual([]);
});
