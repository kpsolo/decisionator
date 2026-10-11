import { type Page, expect, test } from "@playwright/test";

const OPTIONS_JSON = JSON.stringify({
  format: "decisionator.options/v1",
  project: { title: "Team Offsite Deliberation", description: "Where should we go?" },
  options: [{ title: "Mountain Cabin" }, { title: "Beach House" }, { title: "City Hotel" }],
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
  await page.getByRole("button", { name: /^Use 3 options$/ }).click();
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

test("User Story 1: Host reloads page (F5) and guests reconnect within 5 seconds; Host opening join link is recognized", async ({
  page: host,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "WebRTC loopback in CI is exercised on Chromium");
  test.setTimeout(120_000);

  // 1. Create project and start live session
  await createProject(host);
  const { dialog, joinUrl } = await startSession(host);
  expect(joinUrl).toContain("#/join/");

  // Hide host dialog
  await dialog.getByRole("button", { name: "Hide" }).click();

  // 2. Connect guest
  const guest = await context.newPage();
  await guest.goto(joinUrl);
  await joinAs(guest, "Gina");

  // 3. Host tab page reload (F5)
  const reloadStart = Date.now();
  await host.reload();

  // Host should auto-resume live session from sessionStorage activeHosting descriptor
  await expect(
    host.getByRole("button", { name: /^Live session for Team Offsite Deliberation/ })
  ).toBeVisible({ timeout: 5000 });

  // Guest should reconnect to the resumed host within 5 seconds (SC-002)
  await expect(guest.getByText("Live", { exact: true })).toBeVisible({ timeout: 5000 });
  const reconnectElapsed = Date.now() - reloadStart;
  expect(reconnectElapsed).toBeLessThan(10000);

  // 4. Host opens the join link on the same browser profile (FR-001)
  const hostJoinTab = await context.newPage();
  await hostJoinTab.goto(joinUrl);

  // Must recognize current browser as host instead of guest form
  await expect(
    hostJoinTab.getByRole("heading", { name: "You are the host of this session" })
  ).toBeVisible();
  await expect(hostJoinTab.getByRole("button", { name: "Resume Live Session" })).toBeVisible();
  await expect(hostJoinTab.getByRole("button", { name: "Open Project" })).toBeVisible();

  // Click Open Project navigates to project
  await hostJoinTab.getByRole("button", { name: "Open Project" }).click();
  await expect(
    hostJoinTab.getByRole("heading", { name: "Team Offsite Deliberation" })
  ).toBeVisible();

  // 5. User Story 2: Returning guest views cached deliberation while host is offline (< 1s, SC-001)
  // Close host tabs so host is completely offline
  await hostJoinTab.close();
  await host.close();

  // Guest reloads / re-opens joinUrl
  const offlineStart = Date.now();
  await guest.reload();

  // Should immediately display cached decision title, options and offline indicator (< 1000 ms)
  await expect(guest.getByRole("heading", { name: "Team Offsite Deliberation" })).toBeVisible({
    timeout: 1000,
  });
  await expect(guest.getByText(/Host offline • Last synced/).first()).toBeVisible({
    timeout: 1000,
  });
  const offlineRenderTime = Date.now() - offlineStart;
  expect(offlineRenderTime).toBeLessThan(2000);

  // Submissions should be disabled while host is offline
  await expect(guest.getByRole("button", { name: "Submit ballot" })).toBeDisabled();

  // 6. Host reopens project and resumes hosting -> guest smoothly upgrades to live within 5s
  const returningHost = await context.newPage();
  await returningHost.goto("./");
  await returningHost.getByText("Team Offsite Deliberation").first().click();
  await startSession(returningHost);

  // Guest upgrades smoothly to Live status
  await expect(guest.getByText("Live", { exact: true })).toBeVisible({ timeout: 5000 });
});
