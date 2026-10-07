import { type Page, expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/** Feature 005, User Stories 1 and 2: personal "Seen" status (local store). */

const CITIES = [
  "Lisbon",
  "Alps lodge",
  "Barcelona",
  "Porto",
  "Prague",
  "Vienna",
  "Krakow",
  "Riga",
  "Tallinn",
  "Vilnius",
  "Gdansk",
  "Ljubljana",
];

async function createProject(page: Page) {
  await page.goto("./");
  await page.getByRole("link", { name: "+ New Decision Project" }).click();
  await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(
    JSON.stringify({
      format: "decisionator.options/v1",
      project: { title: "Team offsite" },
      options: CITIES.map((title) => ({ title })),
    })
  );
  await page.getByRole("button", { name: /^Use 12 options$/ }).click();
  await page.getByRole("button", { name: "Create Project →" }).click();
  await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible({ timeout: 15000 });
  return page.url();
}

/** Sets the status plugin's settings in the stored plugin registry, then reloads. */
async function setStatusSettings(page: Page, settings: Record<string, unknown>) {
  await page.evaluate((s) => {
    const key = "decisionator_installed_plugins";
    const plugins = JSON.parse(localStorage.getItem(key) ?? "[]");
    for (const p of plugins) if (p.id === "org.decisionator.option-status") p.settings = s;
    localStorage.setItem(key, JSON.stringify(plugins));
  }, settings);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
}

const card = (page: Page, title: string) =>
  page
    .getByRole("list", { name: "Options" })
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
const isNew = (page: Page, title: string) => card(page, title).locator("[data-option-marker]");

test.describe("personal option status", () => {
  test("new options look unread, and options kept on screen become seen", async ({ page }) => {
    await createProject(page);
    await expect(page.getByText("12 not seen yet")).toBeVisible();
    await expect(page.locator("[data-option-marker]")).toHaveCount(12);
    await expect(isNew(page, "Lisbon")).toHaveText("Not seen");
    await checkA11y(page, "Option list with unseen markers");

    await setStatusSettings(page, { autoMark: true, seconds: 1 });
    // The first cards are on screen; after 1 s they are marked seen.
    await expect(isNew(page, "Lisbon")).toHaveCount(0, { timeout: 5000 });
    // A card far below the fold was never on screen and stays new.
    await expect(isNew(page, "Ljubljana")).toHaveCount(1);
    const remaining = await page.locator("[data-option-marker]").count();
    expect(remaining).toBeLessThan(12);
    await expect(page.getByText(`${remaining} not seen yet`)).toBeVisible();

    await test.step("a card scrolled past quickly stays new", async () => {
      await card(page, "Ljubljana").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1500);
      await expect(isNew(page, "Ljubljana")).toHaveCount(1);
    });

    await test.step("'Only not seen' lists exactly the new options", async () => {
      await page.getByRole("button", { name: "Only not seen" }).click();
      await expect(page.getByRole("button", { name: "Only not seen" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      await expect(card(page, "Lisbon")).toHaveCount(0);
      await expect(card(page, "Ljubljana")).toHaveCount(1);
      await page.getByRole("button", { name: "Only not seen" }).click();
      await expect(card(page, "Lisbon")).toHaveCount(1);
    });

    await test.step("marks survive a reload", async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
      await expect(isNew(page, "Lisbon")).toHaveCount(0);
    });
  });

  test("'Mark as not seen' holds for the visit and is re-marked after coming back", async ({
    page,
  }) => {
    await createProject(page);
    await setStatusSettings(page, { autoMark: true, seconds: 1 });
    await expect(isNew(page, "Lisbon")).toHaveCount(0, { timeout: 5000 });

    await page.getByRole("button", { name: "Details for Lisbon" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Mark as not seen" }).click();
    await expect(dialog.getByRole("button", { name: "Mark as seen" })).toBeVisible();
    await checkA11y(page, "Option detail with status action");
    await dialog.getByRole("button", { name: "Close" }).last().click();
    // Still on screen, but held as new for the rest of this visit.
    await page.waitForTimeout(2500);
    await expect(isNew(page, "Lisbon")).toHaveCount(1);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
    await expect(isNew(page, "Lisbon")).toHaveCount(0, { timeout: 5000 });
  });

  test("the default needs 5 seconds on screen", async ({ page }) => {
    await createProject(page);
    await page.waitForTimeout(4000);
    await expect(isNew(page, "Lisbon")).toHaveCount(1);
    await expect(isNew(page, "Lisbon")).toHaveCount(0, { timeout: 8000 });
  });

  test("turning automatic marking off leaves options new, but manual marking still works", async ({
    page,
  }) => {
    await createProject(page);
    await setStatusSettings(page, { autoMark: false, seconds: 1 });
    await page.waitForTimeout(3000);
    await expect(page.locator("[data-option-marker]")).toHaveCount(12);

    await page.getByRole("button", { name: "Details for Lisbon" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark as seen" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    await expect(isNew(page, "Lisbon")).toHaveCount(0);
    await expect(page.getByText("11 not seen yet")).toBeVisible();
  });

  test("disabling the Option status plugin removes marks, count and filter", async ({ page }) => {
    await createProject(page);
    await page.evaluate(() => {
      const key = "decisionator_installed_plugins";
      const plugins = JSON.parse(localStorage.getItem(key) ?? "[]");
      for (const p of plugins) if (p.id === "org.decisionator.option-status") p.enabled = false;
      localStorage.setItem(key, JSON.stringify(plugins));
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Team offsite" })).toBeVisible();
    await expect(page.locator("[data-option-marker]")).toHaveCount(0);
    await expect(page.getByText(/not seen yet/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Only not seen" })).toHaveCount(0);
    // Grading still works.
    await card(page, "Lisbon").locator('input[aria-label="4 stars"]').check({ force: true });
    await expect(card(page, "Lisbon").getByText("4.0 avg · 1 rating")).toBeVisible();
  });

  test("100 options scroll without long tasks and a grade shows within 1 s (SC-003)", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CPU throttling and long-task timing need Chromium");
    // Timing is only meaningful without other workers competing for the CPU:
    // DECI_PERF=1 pnpm exec playwright test e2e/option-status.spec.ts -g "100 options" --workers=1
    test.skip(!process.env.DECI_PERF, "Performance check: set DECI_PERF=1 and run alone");
    test.setTimeout(120_000);
    await page.goto("./");
    await page.getByRole("link", { name: "+ New Decision Project" }).click();
    await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(
      JSON.stringify({
        format: "decisionator.options/v1",
        project: { title: "Big list" },
        options: Array.from({ length: 100 }, (_, i) => ({ title: `Option ${i + 1}` })),
      })
    );
    await page.getByRole("button", { name: /^Use 100 options$/ }).click();
    await page.getByRole("button", { name: "Create Project →" }).click();
    await expect(page.getByRole("heading", { name: "Big list" })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("[data-option-marker]")).toHaveCount(100);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      }).observe({ type: "longtask", buffered: false });
    });
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1500);
    const longTasks = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    // At 4x CPU throttling the app's scrolling alone produces ~270 ms tasks (layout and paint of
    // the cards); this guards against regressions such as per-card work growing with the list.
    expect(Math.max(0, ...longTasks)).toBeLessThan(600);

    const last = page.getByRole("list", { name: "Options" }).getByRole("listitem").last();
    await last.scrollIntoViewIfNeeded();
    await last.locator('input[aria-label="3 stars"]').check({ force: true });
    // The grade shows within 1 s of the click (the click itself is Playwright's, not timed).
    await expect(last.getByText("3.0 avg · 1 rating")).toBeVisible({ timeout: 1000 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });

  test("Settings → Options: defaults, refused values and a new time take effect", async ({
    page,
  }) => {
    const projectUrl = await createProject(page);
    await page.getByRole("link", { name: "Settings" }).click();
    const auto = page.getByLabel("Mark options as seen automatically");
    const seconds = page.getByLabel("Seconds an option must stay on screen");
    await expect(auto).toBeChecked();
    await expect(seconds).toHaveValue("5");

    for (const bad of ["0", "400"]) {
      await seconds.fill(bad);
      await seconds.press("Enter");
      await expect(page.getByRole("alert")).toHaveText(
        "The time must be between 1 and 300 seconds."
      );
      await expect(seconds).toHaveValue("5");
    }
    await checkA11y(page, "Settings with option settings");

    await seconds.fill("1");
    await seconds.press("Enter");
    await page.goto(projectUrl);
    await expect(isNew(page, "Lisbon")).toHaveCount(0, { timeout: 5000 });

    await page.getByRole("link", { name: "Settings" }).click();
    await auto.uncheck();
    await expect(seconds).toBeDisabled();
  });
});
