import { type Page, expect, test } from "@playwright/test";

const OPTIONS_JSON = JSON.stringify({
  format: "decisionator.options/v1",
  project: { title: "Admin Moderation Deliberation", description: "Testing moderation features" },
  options: [{ title: "Option One" }, { title: "Option Two" }],
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "deci.live.network",
      JSON.stringify({
        relays: [],
        iceServers: [],
        sameBrowser: true,
      })
    );
  });
});

async function createProject(page: Page) {
  await page.goto("./");
  await page.getByRole("link", { name: "+ New Decision Project" }).click();
  await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(OPTIONS_JSON);
  await page.getByRole("button", { name: /^Use 2 options$/ }).click();
  await page.getByRole("button", { name: "Create Project →" }).click();
  await expect(page.getByRole("heading", { name: "Admin Moderation Deliberation" })).toBeVisible({
    timeout: 15000,
  });
  return page.url();
}

async function startSession(host: Page) {
  await host.getByRole("button", { name: "More project actions" }).click();
  await host.getByRole("menuitem", { name: "Live session…" }).click();
  const dialog = host.getByRole("dialog");
  await expect(dialog.getByText("Live", { exact: true })).toBeVisible({ timeout: 10000 });
  const joinUrl = await dialog.getByRole("textbox", { name: "Join link" }).inputValue();
  return { dialog, joinUrl };
}

async function joinAs(guest: Page, name: string) {
  await guest.getByRole("textbox", { name: "Your name" }).fill(name);
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.getByRole("heading", { name: "Admin Moderation Deliberation" })).toBeVisible({
    timeout: 20000,
  });
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();
}

test("User Story 5: Host toggles read-only mode and drops participant votes with guest notification", async ({
  page: host,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium" || (Boolean(process.env.CI) && process.platform === "darwin"),
    "WebRTC loopback in CI is exercised on Linux and Windows"
  );
  test.setTimeout(120_000);

  // 1. Create project and start live session
  await createProject(host);
  const { dialog, joinUrl } = await startSession(host);

  // 2. Connect guest Tom
  const guest = await context.newPage();
  await guest.goto(joinUrl);
  await joinAs(guest, "Tom");

  // 3. Tom grades Option One with 4 stars
  await guest.locator('input[aria-label="4 stars"]').first().check({ force: true });
  await expect(guest.locator('input[aria-label="4 stars"]').first()).toBeChecked();

  // 4. Host inspects roster in live panel
  await expect(dialog.getByText("Tom")).toBeVisible();
  await expect(dialog.getByText("1 grade", { exact: false })).toBeVisible();

  // 5. Host turns on Read-only mode
  const readOnlyToggle = dialog.getByLabel("Read-only mode");
  await readOnlyToggle.click();

  // Guest immediately sees read-only banner within 1000ms (< 1000 ms) (FR-015, SC-003)
  await expect(guest.getByText("The host made this session view-only.").first()).toBeVisible({
    timeout: 2000,
  });

  // Host turns off Read-only mode
  await readOnlyToggle.click();
  await expect(guest.getByText("The host made this session view-only.")).toHaveCount(0, {
    timeout: 2000,
  });

  // 6. Host drops Tom's votes
  await dialog.getByRole("button", { name: "Drop votes" }).click();

  const confirmModal = host.getByRole("dialog").filter({ hasText: "Drop votes from Tom?" });
  await expect(confirmModal).toBeVisible();
  await confirmModal.getByRole("button", { name: "Drop votes" }).click();

  // Guest receives reset notification / toast (FR-030)
  await expect(guest.getByText("The host reset your votes.").first()).toBeVisible({
    timeout: 5000,
  });

  // Tom's grade is cleared
  await expect(guest.locator('input[aria-label="4 stars"]').first()).not.toBeChecked();
});
