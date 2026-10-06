import { type Page, expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/**
 * T043: automated WCAG 2.1 AA audit (axe) across routes, wizard states and overlays, in both
 * themes, plus keyboard focus management for dialogs (FR-007, FR-009, FR-010, SC-002).
 * Story specs (us1–us3) cover the project/vote screens that need a seeded backend.
 */

const OPTIONS_JSON = JSON.stringify(
  {
    format: "decisionator.options/v1",
    project: { title: "Weekend plans" },
    options: [
      { title: "Picnic in the park", description: "Bring food and games.", category: "Outdoors" },
      { title: "Board games night", tags: ["indoors"], effort: "XS" },
    ],
  },
  null,
  2
);

async function setup(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("decisionator-theme", t);
    } catch {}
  }, theme);
  // No real Google traffic from an audit run.
  await page.route("**/*googleapis.com/**", (route) => route.fulfill({ status: 200, json: {} }));
}

/** Fills the paste box the way a clipboard paste does (paste event, then input). */
async function pasteInto(page: Page, text: string) {
  const textarea = page.getByRole("textbox", { name: "Ideas or options JSON" });
  await textarea.focus();
  await textarea.evaluate((el, value) => {
    const ta = el as HTMLTextAreaElement;
    const data = new DataTransfer();
    data.setData("text/plain", value);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`a11y audit (${theme} theme)`, () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, theme);
    });

    test("theme is applied before first paint", async ({ page }) => {
      await page.goto("./");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    });

    test("home page and theme menu", async ({ page }) => {
      await page.goto("./");
      await expect(page.getByText("My Decision Projects")).toBeVisible();
      await checkA11y(page, `Home (${theme})`);

      await page.getByRole("button", { name: /Change theme/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await checkA11y(page, `Theme menu (${theme})`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
    });

    test("new project wizard: paste, JSON detection, preview and clear-draft dialog", async ({
      page,
    }) => {
      await page.goto("./#/new");
      await expect(page.getByText("Step 1: Paste Your Ideas")).toBeVisible();
      await checkA11y(page, `Wizard paste step (${theme})`);

      // Invalid JSON shows the error panel instead of shredding it into a plain list.
      await page
        .getByRole("textbox", { name: "Ideas or options JSON" })
        .fill('{"options": [{"name": "no title"}]}');
      await expect(
        page.getByText("This looks like JSON, but it isn't a valid options list")
      ).toBeVisible();
      await checkA11y(page, `Wizard invalid JSON (${theme})`);

      // A valid options JSON pasted from an agent goes straight to the preview.
      await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill("");
      await pasteInto(page, `Here you go:\n\`\`\`json\n${OPTIONS_JSON}\n\`\`\``);
      await expect(page.getByText("Step 3: Review & Edit Project")).toBeVisible();
      await expect(page.locator("#project-title-input")).toHaveValue("Weekend plans");
      await expect(page.getByText("Options (2)")).toBeVisible();
      await checkA11y(page, `Wizard preview (${theme})`);

      await page.getByRole("button", { name: "Clear draft" }).click();
      await expect(page.getByRole("dialog", { name: "Clear this draft?" })).toBeVisible();
      await checkA11y(page, `Clear draft dialog (${theme})`);
      await page.getByRole("dialog").getByRole("button", { name: "Clear draft" }).click();
      await expect(page.getByText("Step 1: Paste Your Ideas")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Ideas or options JSON" })).toHaveValue("");
    });

    test("settings page", async ({ page }) => {
      await page.goto("./#/settings");
      await expect(page.getByRole("heading", { name: "Application Settings" })).toBeVisible();
      await checkA11y(page, `Settings (${theme})`);
    });

    test("plugins page and plugin settings dialog", async ({ page }) => {
      await page.goto("./#/plugins");
      await expect(page.getByText("Borda count ranking strategy")).toBeVisible();
      await checkA11y(page, `Plugins (${theme})`);

      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await checkA11y(page, `Plugin settings dialog (${theme})`);
    });
  });
}

test.describe("keyboard and responsive behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, "light");
  });

  test("dialogs trap focus, close on Escape and return focus to the trigger", async ({ page }) => {
    await page.goto("./#/plugins");
    const trigger = page.getByRole("button", { name: "Settings", exact: true }).first();
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("phone viewport: no horizontal overflow and an accessible home page", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("./");
    await expect(page.getByText("My Decision Projects")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await checkA11y(page, "Home (360px)");
  });
});
