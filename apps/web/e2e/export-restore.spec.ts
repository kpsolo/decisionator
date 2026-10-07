import fs from "node:fs";
import { readWorkbook } from "@decisionator/core";
import { type Page, expect, test } from "@playwright/test";

/**
 * Export & restore on the default local store (no Google mocks):
 * paste ideas → grade some and vote → view the ranking → change the ranking system → view the
 * new ranking → export JSON and Excel (.xlsx, also opens in Google Sheets) → upload each file
 * on the home page → the restored project has the same options, grades, comments, ballot and
 * outcomes, and its outcome still verifies.
 */

const IDEAS = ["Lisbon", "Alps lodge", "Rent a loft", "Barcelona"].join("\n");
const TITLE = "Offsite export test";

async function openMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name }).click();
}

async function decideWith(page: Page, strategy: RegExp): Promise<string> {
  await page.getByRole("radio", { name: strategy }).check();
  await page.getByRole("button", { name: /^Decide with / }).click();
  const done = page.getByText(/Decision executed: Winner is "(.+)"/);
  await expect(done).toBeVisible({ timeout: 10000 });
  return /Winner is "(.+)"/.exec((await done.textContent()) ?? "")?.[1] ?? "";
}

/** Asserts what a restored project must show: content, my grades & ballot, both outcomes. */
async function expectRestored(page: Page, weightedWinner: string) {
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/#\/p\/file\/file_/);
  const projectUrl = page.url();

  await expect(page.getByText("5.0 avg · 1 rating")).toBeVisible();
  await expect(page.getByText("3.0 avg · 1 rating")).toBeVisible();
  await expect(page.getByRole("button", { name: /^1 comment$/ })).toBeVisible();

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page.getByText("Ranked by: Random Weighted by Grades")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole("heading", { name: weightedWinner, exact: true })).toBeVisible();
  await expect(page.getByText("Decision History (2 outcomes)")).toBeVisible();
  // The restored outcome keeps its seed and inputs, so re-running it gives the same result.
  await page.getByRole("button", { name: "Verify Outcome" }).click();
  await expect(page.getByText("Reproduced ✓")).toBeVisible();

  await page.goto(projectUrl);
  await page.getByRole("link", { name: "Vote" }).click();
  await expect(page.getByRole("button", { name: "Update Ballot" })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole("button", { name: "Move Barcelona up" })).toBeDisabled();
}

test("paste → vote → rank → change ranking system → export → restore", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("./");
  let projectUrl = "";

  await test.step("paste ideas as a plain list and create the project", async () => {
    await page.getByRole("link", { name: "+ New Decision Project" }).click();
    await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(IDEAS);
    await page.getByRole("button", { name: "Use as plain list" }).click();
    await expect(page.getByText("Options (4)")).toBeVisible();
    await page.locator("#project-title-input").fill(TITLE);
    await page.getByRole("button", { name: "Create Project →" }).click();
    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible({ timeout: 15000 });
    projectUrl = page.url();
  });

  await test.step("grade some options and comment", async () => {
    await page.locator('input[aria-label="5 stars"]').nth(0).check({ force: true }); // Lisbon
    await page.locator('input[aria-label="3 stars"]').nth(1).check({ force: true }); // Alps lodge
    await expect(page.getByText("5.0 avg · 1 rating")).toBeVisible();
    await expect(page.getByText("3.0 avg · 1 rating")).toBeVisible();

    await page
      .getByRole("button", { name: /^Comment$/ })
      .first()
      .click();
    await page.getByPlaceholder("Add a comment (Markdown supported)...").fill("Direct flights");
    await page.getByRole("button", { name: "Post Comment" }).click();
    await expect(page.getByRole("button", { name: /^1 comment$/ })).toBeVisible();
  });

  await test.step("vote: rank Barcelona first", async () => {
    await page.getByRole("link", { name: "Vote" }).click();
    await expect(page.getByText("Rank Your Top 3 Options")).toBeVisible({ timeout: 10000 });
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Move Barcelona up" }).click();
    }
    await page.getByRole("button", { name: "Submit Ballot" }).click();
    await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();
  });

  let weightedWinner = "";
  await test.step("view the ranking (Borda count over ballots)", async () => {
    await page.getByRole("link", { name: "Results" }).click();
    await expect(page.getByText("No Outcomes Recorded Yet")).toBeVisible({ timeout: 10000 });

    expect(await decideWith(page, /Borda Count Ranking/)).toBe("Barcelona");
    await expect(page.getByText("Ranked by: Borda Count Ranking")).toBeVisible();
    await expect(page.getByText("3 pts")).toBeVisible();
    await expect(page.getByText("Round 1 Winner")).toBeVisible();
  });

  await test.step("change the ranking system and view the new ranking", async () => {
    // Weighted draw only picks graded options (Lisbon 5★, Alps lodge 3★).
    weightedWinner = await decideWith(page, /Random Weighted by Grades/);
    expect(["Lisbon", "Alps lodge"]).toContain(weightedWinner);
    await expect(page.getByText("Ranked by: Random Weighted by Grades")).toBeVisible();
    await expect(page.getByText("Decision History (2 outcomes)")).toBeVisible();

    // The latest outcome stays in force after a reload, and the chooser starts from it.
    await page.reload();
    await expect(page.getByText("Ranked by: Random Weighted by Grades")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("radio", { name: /Random Weighted by Grades/ })).toBeChecked();
  });

  const jsonPath = testInfo.outputPath("export.json");
  const xlsxPath = testInfo.outputPath("export.xlsx");

  await test.step("export the project as JSON and as Excel / Google Sheets", async () => {
    await page.goto(projectUrl);
    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible({ timeout: 10000 });

    let download = page.waitForEvent("download");
    await openMenuItem(page, "Export Project (JSON)");
    expect((await download).suggestedFilename()).toBe("offsite-export-test-export.json");
    await (await download).saveAs(jsonPath);

    download = page.waitForEvent("download");
    await openMenuItem(page, "Export Project (Excel / Google Sheets)");
    expect((await download).suggestedFilename()).toBe("offsite-export-test-export.xlsx");
    await (await download).saveAs(xlsxPath);

    const bundle = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    expect(bundle.format).toBe("decisionator.project/v1");
    expect(bundle.options).toHaveLength(4);
    expect(bundle.grades).toHaveLength(2);
    expect(bundle.rankings).toHaveLength(1);
    expect(bundle.outcomes).toHaveLength(2);

    const sheets = readWorkbook(new Uint8Array(fs.readFileSync(xlsxPath)));
    expect([...sheets.keys()]).toEqual([
      "Project",
      "Ranking",
      "Options",
      "Grades",
      "Ballots",
      "Comments",
      "Outcomes",
      "Contributions",
    ]);
    expect(sheets.get("Ranking")?.[1]?.[1]).toBe(weightedWinner);
    expect(sheets.get("Ballots")?.[1]?.slice(-3)).toEqual(["Barcelona", "Lisbon", "Alps lodge"]);
  });

  await test.step("delete the original project", async () => {
    await openMenuItem(page, "Delete Project...");
    await page.getByRole("dialog").getByRole("textbox").fill(TITLE);
    await page.getByRole("button", { name: "Permanently Delete" }).click();
    await expect(page.getByText("My Decision Projects")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(TITLE)).toHaveCount(0);
  });

  await test.step("upload the Excel file: the project is restored", async () => {
    await page.getByLabel("Project file to open").setInputFiles(xlsxPath);
    await expectRestored(page, weightedWinner);
  });

  await test.step("upload the JSON file: the project is restored", async () => {
    await page.goto("./");
    await page.getByLabel("Project file to open").setInputFiles(jsonPath);
    await expectRestored(page, weightedWinner);
  });

  await test.step("a file that is not a project export is rejected", async () => {
    await page.goto("./");
    await page.getByLabel("Project file to open").setInputFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"hello":"world"}'),
    });
    await expect(page.getByRole("alert")).toContainText("Failed to open decision file");
  });

  expect(pageErrors).toEqual([]);
});
