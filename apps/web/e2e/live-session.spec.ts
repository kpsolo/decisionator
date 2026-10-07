import { type Page, expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/**
 * Live session between two pages over real WebRTC data channels. Both pages share one browser
 * context, so they rendezvous through BroadcastChannel; public relays are switched off so the
 * test never leaves the machine.
 */

const OPTIONS_JSON = JSON.stringify({
  format: "decisionator.options/v1",
  project: { title: "Friday lunch", description: "Where do we eat?" },
  options: [{ title: "Ramen" }, { title: "Tacos" }, { title: "Salad bar" }],
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "deci.live.network",
      JSON.stringify({ relays: [], iceServers: [], sameBrowser: true })
    );
  });
});

async function createProject(page: Page) {
  await page.goto("./");
  await page.getByRole("link", { name: "+ New Decision Project" }).click();
  await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(OPTIONS_JSON);
  await page.getByRole("button", { name: /^Use 3 options$/ }).click();
  await page.getByRole("button", { name: "Create Project →" }).click();
  await expect(page.getByRole("heading", { name: "Friday lunch" })).toBeVisible({ timeout: 15000 });
  return page.url();
}

async function startSession(host: Page) {
  await host.getByRole("button", { name: "More project actions" }).click();
  await host.getByRole("menuitem", { name: "Live session…" }).click();
  const dialog = host.getByRole("dialog");
  await expect(dialog.getByText("Live", { exact: true })).toBeVisible({ timeout: 10000 });
  return dialog;
}

/** Joins from a page of the same browser as a different device (its own guest identity). */
async function joinAsOtherDevice(guest: Page, joinUrl: string, name: string) {
  await guest.goto(joinUrl);
  const saved = await guest.evaluate(() => {
    const previous = localStorage.getItem("deci.live.device");
    localStorage.setItem("deci.live.device", `other-${Math.random().toString(36).slice(2)}`);
    return previous;
  });
  await joinAs(guest, name);
  // The identity was derived on join; give the shared storage back to the first guest.
  await guest.evaluate((previous) => {
    if (previous) localStorage.setItem("deci.live.device", previous);
  }, saved);
}

async function joinAs(guest: Page, name: string) {
  await guest.getByRole("textbox", { name: "Your name" }).fill(name);
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.getByRole("heading", { name: "Friday lunch" })).toBeVisible({
    timeout: 20000,
  });
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();
}

test("live session: guests vote over WebRTC, attributed, and the session outlives navigation", async ({
  page: host,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "WebRTC loopback in CI is exercised on Chromium");
  test.setTimeout(120_000);
  const errors: string[] = [];
  host.on("pageerror", (e) => errors.push(e.message));

  await createProject(host);
  await host.locator('input[aria-label="5 stars"]').first().check({ force: true });
  await expect(host.getByText("5.0 avg · 1 rating")).toBeVisible();

  const dialog = await startSession(host);
  await expect(dialog.getByRole("img", { name: "QR code for the join link" })).toBeVisible();
  const joinUrl = await dialog.getByRole("textbox", { name: "Join link" }).inputValue();
  expect(joinUrl).toMatch(/#\/join\/[\w-]+\/[\w-]+$/);
  await checkA11y(host, "Live session dialog");

  // Hiding the dialog keeps the session running.
  await dialog.getByRole("button", { name: "Hide" }).click();
  await expect(host.getByRole("button", { name: /^Live session for Friday lunch/ })).toBeVisible();

  const guest = await context.newPage();
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(joinUrl);
  await joinAs(guest, "Gina");
  await expect(host.getByRole("button", { name: /Friday lunch, 1 connected/ })).toBeVisible();

  await test.step("a guest grade is recorded for the guest, not over the owner's", async () => {
    await guest.locator('input[aria-label="2 stars"]').first().check({ force: true });
    await expect(host.getByText("3.5 avg · 2 ratings")).toBeVisible({ timeout: 10000 });
    await expect(guest.getByText("3.5 avg · 2 ratings")).toBeVisible({ timeout: 10000 });
    await expect(guest.locator('input[aria-label="2 stars"]').first()).toBeChecked();
  });

  await test.step("a guest comment shows the guest's name to the host", async () => {
    await guest
      .getByRole("button", { name: /^Comment$/ })
      .first()
      .click();
    await guest.getByPlaceholder("Add a comment (Markdown supported)...").fill("Ramen please");
    await guest.getByRole("button", { name: "Post Comment" }).click();
    await host.getByRole("button", { name: /^1 comment$/ }).click();
    await expect(host.getByText("Ramen please")).toBeVisible({ timeout: 10000 });
    await expect(host.getByText("Gina", { exact: true })).toBeVisible();
    // Cleared only once the host confirmed it, and shown right away.
    await expect(guest.getByRole("textbox", { name: "Add a comment" })).toHaveValue("");
    await expect(guest.getByText("Ramen please")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Edit" })).toBeVisible();
  });

  await test.step("a guest who reloads keeps their identity and their grade", async () => {
    await guest.reload();
    await joinAs(guest, "Gina");
    await expect(guest.locator('input[aria-label="2 stars"]').first()).toBeChecked();
    await expect(host.getByText("3.5 avg · 2 ratings")).toBeVisible();
    await checkA11y(guest, "Live guest view");
  });

  await test.step("the session survives the host navigating to other pages", async () => {
    // In-app navigation only: reloading the host tab would end the session, by design.
    await host.getByRole("link", { name: "Results" }).click();
    await expect(host.getByRole("heading", { name: "Decision Outcome & Results" })).toBeVisible();
    await guest.getByRole("button", { name: "Submit Ballot" }).click();
    await expect(guest.getByText("Ballot submitted successfully!")).toBeVisible({ timeout: 10000 });
    // The host's broadcast now carries a ballot attributed to this guest.
    await expect(guest.getByRole("button", { name: "Update Ballot" })).toBeVisible();
    await host.getByRole("link", { name: "Project", exact: true }).click();
    await expect(host.getByRole("heading", { name: "Friday lunch" })).toBeVisible();
  });

  await test.step("a second guest with the same name joins under a numbered name", async () => {
    const twin = await context.newPage();
    twin.on("pageerror", (e) => errors.push(e.message));
    await joinAsOtherDevice(twin, joinUrl, "Gina");
    await expect(twin.getByText("You're Gina 2")).toBeVisible();
    await expect(guest.getByText("You're Gina", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: /^Live session for Friday lunch/ }).click();
    const people = host.getByRole("dialog").getByRole("list", { name: "Connected people" });
    await expect(people.getByText("Gina", { exact: true })).toBeVisible();
    await expect(people.getByText("Gina 2", { exact: true })).toBeVisible();
    await host.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
    await twin.close();
    await expect(host.getByRole("button", { name: /Friday lunch, 1 connected/ })).toBeVisible();
  });

  await test.step("closing voting reaches the guest within a second; grading still works", async () => {
    await host.getByRole("link", { name: "Vote" }).click();
    await host.getByRole("button", { name: "Close Voting & Tally Results" }).click();
    await expect(guest.getByText("Voting is closed.")).toBeVisible({ timeout: 1000 });
    await expect(guest.getByRole("button", { name: "Update Ballot" })).toBeDisabled();

    await guest.locator('input[aria-label="5 stars"]').nth(1).check({ force: true });
    await host.getByRole("link", { name: "Project", exact: true }).click();
    await expect(host.getByText("5.0 avg · 1 rating")).toBeVisible({ timeout: 10000 });
  });

  await test.step("changes the host refuses are reported and rolled back", async () => {
    // 80 grade changes at once: well over what the host accepts in a burst, even on a busy CPU.
    await guest.evaluate(() => {
      for (let i = 0; i < 80; i++) {
        const stars = i % 2 === 0 ? "3 stars" : "4 stars";
        document.querySelectorAll<HTMLInputElement>(`input[aria-label="${stars}"]`)[0]?.click();
      }
    });
    await expect(
      guest.getByText("Too many changes at once. Try again shortly.").first()
    ).toBeVisible({ timeout: 10000 });
    // What the guest sees settles on what the host saved.
    await expect
      .poll(
        async () => {
          const mine = (await guest.locator('input[aria-label="3 stars"]').first().isChecked())
            ? 3
            : 4;
          const shown = await host
            .getByText(/avg · 2 ratings/)
            .first()
            .textContent();
          return shown === `${((5 + mine) / 2).toFixed(1)} avg · 2 ratings`;
        },
        { timeout: 10000 }
      )
      .toBe(true);
  });

  await test.step("ending the session tells the guest and lets them keep a copy", async () => {
    await host.getByRole("button", { name: /^Live session for Friday lunch/ }).click();
    await host.getByRole("dialog").getByRole("button", { name: "End session" }).click();
    await expect(guest.getByText(/The host ended the session/)).toBeVisible({ timeout: 10000 });
    await expect(guest.getByRole("button", { name: "Save a copy" })).toBeVisible();
    await expect(guest.locator('input[aria-label="4 stars"]').first()).toBeDisabled();
    await guest.getByRole("button", { name: /^1 comment$/ }).click();
    await expect(guest.getByText("Ramen please")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(guest.getByRole("textbox", { name: "Add a comment" })).toHaveAttribute(
      "placeholder",
      "Commenting unavailable"
    );
  });

  expect(errors).toEqual([]);
});

test("closing the host tab asks first, then tells guests", async ({
  page: host,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "WebRTC loopback in CI is exercised on Chromium");
  test.setTimeout(90_000);

  await createProject(host);
  const dialog = await startSession(host);
  const joinUrl = await dialog.getByRole("textbox", { name: "Join link" }).inputValue();
  await dialog.getByRole("button", { name: "Hide" }).click();
  const guest = await context.newPage();
  await guest.goto(joinUrl);
  await joinAs(guest, "Gina");
  await expect(host.getByRole("button", { name: /Friday lunch, 1 connected/ })).toBeVisible();

  // The first attempt is cancelled: the session keeps running.
  const kept = host.waitForEvent("dialog");
  await host.close({ runBeforeUnload: true });
  const prompt = await kept;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();
  expect(host.isClosed()).toBe(false);

  // The second is confirmed: the tab goes and the guest is told why.
  host.once("dialog", (d) => void d.accept());
  await host.close({ runBeforeUnload: true });
  await expect(guest.getByText(/The host closed their tab\./)).toBeVisible({ timeout: 10000 });
});

test("a join link without its secret explains what to do", async ({ page }) => {
  await page.goto("./#/join/abc123");
  await expect(page.getByText("This join link is incomplete")).toBeVisible();
});
