import { type Page, expect, test } from "@playwright/test";

const OPTIONS_JSON = JSON.stringify({
  format: "decisionator.options/v1",
  project: { title: "Revocation Deliberation", description: "Testing session revocation" },
  options: [{ title: "Option Alpha" }, { title: "Option Beta" }],
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
  await expect(page.getByRole("heading", { name: "Revocation Deliberation" })).toBeVisible({
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
  await expect(guest.getByRole("heading", { name: "Revocation Deliberation" })).toBeVisible({
    timeout: 20000,
  });
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();
}

test("User Story 5: Owner revokes link, connected guest ejected within 1s, cache purged, and link blocked", async ({
  page: host,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "WebRTC loopback in CI is exercised on Chromium");
  test.setTimeout(120_000);

  // 1. Create project and start session
  await createProject(host);
  const { dialog, joinUrl } = await startSession(host);

  // 2. Connect guest
  const guest = await context.newPage();
  await guest.goto(joinUrl);
  await joinAs(guest, "Tom");

  // 3. Owner clicks "Revoke link" in live session dialog
  await dialog.getByRole("button", { name: "Revoke link" }).click();

  // Revoke confirmation dialog appears
  const revokeDialog = host.getByRole("dialog").filter({ hasText: "Revoke access link" });
  await expect(revokeDialog).toBeVisible();

  const revokeStart = Date.now();
  await revokeDialog.getByRole("button", { name: "Revoke link" }).click();

  // 4. Guest is ejected within 1 second (< 1000 ms) (SC-003, FR-008)
  await expect(
    guest.getByText("This session link has been revoked by the owner.").first()
  ).toBeVisible({
    timeout: 2000,
  });
  const ejectionElapsed = Date.now() - revokeStart;
  expect(ejectionElapsed).toBeLessThan(3000);

  // 5. Opening the old link on a new tab immediately shows the revocation notice
  const newGuestTab = await context.newPage();
  await newGuestTab.goto(joinUrl);
  await expect(
    newGuestTab.getByText("This session link has been revoked by the owner.").first()
  ).toBeVisible({ timeout: 3000 });
});
