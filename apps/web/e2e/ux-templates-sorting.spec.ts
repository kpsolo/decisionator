import { expect, test } from "@playwright/test";

test.describe("UX Improvements: Starter Templates, Option Sorting & Ballot Status", () => {
  test("creates project from starter template and tests option sorting & ballot status", async ({
    page,
  }) => {
    // 1. Visit wizard
    await page.goto("/#/new");
    await expect(page.getByRole("heading", { name: "Step 1: Paste Your Ideas" })).toBeVisible();

    // 2. Starter template buttons must be visible
    const templateButton = page.getByRole("button", { name: /Team Offsite/ });
    await expect(templateButton).toBeVisible();

    // 3. Click starter template
    await templateButton.click();

    // 4. Automatically takes user to Step 3 Preview with pre-populated title and options
    await expect(
      page.getByRole("heading", { name: "Step 3: Review & Edit Project" })
    ).toBeVisible();
    await expect(page.getByLabel("Project Title *")).toHaveValue("Q2 Team Offsite Destination");
    await expect(page.getByText("Lisbon, Portugal")).toBeVisible();
    await expect(page.getByText("Tokyo, Japan")).toBeVisible();

    // 5. Confirm project creation
    await page.getByRole("button", { name: /Create Project/ }).click();

    // 6. Arrive at Project View
    await expect(page.getByRole("heading", { name: "Q2 Team Offsite Destination" })).toBeVisible();

    // 7. Verify sorting dropdown exists
    const sortSelect = page.getByLabel("Sort options");
    await expect(sortSelect).toBeVisible();
    await expect(sortSelect).toHaveValue("default");

    // Test sort by Title (A–Z)
    await sortSelect.selectOption("alpha-asc");
    // "Banff National Park, Canada" should now be the first item
    const optionCards = page.locator("li[data-option-id]");
    await expect(optionCards.first()).toContainText("Banff National Park, Canada");

    // 8. Test card title affordance (has title tooltip and ChevronRight instead of ArrowUpRight)
    const firstCard = optionCards.first();
    await expect(firstCard).toHaveAttribute(
      "title",
      "Click card to view details, pros/cons, and comments"
    );

    // 9. Navigate to Vote
    await page.getByRole("link", { name: "Vote" }).click();
    await expect(page.getByRole("heading", { name: "Ballot / Voting" })).toBeVisible();

    // 10. Submit ballot
    await page.getByRole("button", { name: "Submit Ballot" }).click();

    // 11. Verify persistent ballot confirmation banner
    await expect(
      page.getByText(/Your ballot is recorded. You can adjust your ranking anytime/)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Update Ballot" })).toBeVisible();
  });
});
