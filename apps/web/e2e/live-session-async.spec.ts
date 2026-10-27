import { expect, test } from "@playwright/test";

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

test("User Story 3: Displays damaged link notice for malformed join URLs", async ({ page }) => {
  // Join URL with truncated sessionId and secret
  await page.goto("./#/join/short/bad");

  await expect(
    page.getByRole("heading", { name: "This link is incomplete or damaged." })
  ).toBeVisible({
    timeout: 5000,
  });
});

test("Join links without a host key are refused as out of date", async ({ page }) => {
  await page.goto("./#/join/nonexist12/nonexistsecret123456");

  await expect(page.getByText("This link is out of date.")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveCount(0);
});

test("User Story 3: Clean browser profile shows unreachable notice when host is offline and no record exists", async ({
  page,
}) => {
  // Non-existent session; the host key is a valid curve point (secp256k1 G) that nobody hosts.
  await page.goto(
    "./#/join/nonexist12/nonexistsecret123456/79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
  );

  // In join form, enter name
  await page.getByRole("textbox", { name: "Your name" }).fill("Alice");
  await page.getByRole("button", { name: "Join" }).click();

  // Host cannot be reached; after timeout shows unreachable message with Retry (FR-006, SC-004)
  await expect(
    page.getByRole("heading", { name: "This session can't be reached right now." })
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Could not reach the host|The host may be offline/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
