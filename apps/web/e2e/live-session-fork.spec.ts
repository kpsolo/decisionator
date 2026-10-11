import { type Page, expect, test } from "@playwright/test";

const OPTIONS_JSON = JSON.stringify({
  format: "decisionator.options/v1",
  project: { title: "Team Offsite Deliberation", description: "Where should we go?" },
  options: [{ title: "Mountain Cabin" }, { title: "Beach House" }],
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
  await expect(page.getByRole("heading", { name: "Team Offsite Deliberation" })).toBeVisible({
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
  await expect(guest.getByRole("heading", { name: "Team Offsite Deliberation" })).toBeVisible({
    timeout: 20000,
  });
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();
}

test("User Story 4: Collaborator can fork a shared session into their own permanent workspace", async ({
  page: host,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium" || (Boolean(process.env.CI) && process.platform === "darwin"),
    "WebRTC loopback in CI is exercised on Linux and Windows"
  );
  test.setTimeout(120_000);

  // 1. Host creates project and starts live session
  await createProject(host);
  const { joinUrl } = await startSession(host);

  // 2. Guest Gina joins
  const guest = await context.newPage();
  await guest.goto(joinUrl);
  await joinAs(guest, "Gina");

  // 3. Gina clicks "Save to my workspace" in the header
  const saveBtn = guest.getByRole("button", { name: "Save to my workspace" });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  // 4. Fork dialog opens
  const forkDialog = guest.getByRole("dialog");
  await expect(forkDialog).toBeVisible();
  await expect(forkDialog.getByRole("heading", { name: "Save to my workspace" })).toBeVisible();

  // 5. Confirm save to workspace
  await forkDialog.getByRole("button", { name: "Save to workspace" }).click();

  // 6. Redirected to the new project in personal workspace
  await expect(guest).toHaveURL(/\/p\/file\//, { timeout: 15000 });
  await expect(guest.getByRole("heading", { name: "Team Offsite Deliberation" })).toBeVisible({
    timeout: 10000,
  });
  await expect(guest.getByText("Mountain Cabin")).toBeVisible();
  await expect(guest.getByText("Beach House")).toBeVisible();
});
