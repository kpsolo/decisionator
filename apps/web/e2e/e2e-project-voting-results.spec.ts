import { expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

/**
 * End-to-End browser verification:
 * 1. New Project Creation: creates a decision project with structured options.
 * 2. Voting: navigates to the ballot screen, ranks candidate options, and submits ballot.
 * 3. Results Pulling: navigates to the results screen, executes tallying/strategy,
 *    pulls winning outcome and reproduces verification ("Reproduced ✓").
 */

const TEST_OPTIONS_PAYLOAD = JSON.stringify({
  format: "decisionator.options/v1",
  project: {
    title: "Quarterly Team Offsite Destination",
    description: "Deliberation and ranked choice for Q4 team retreat location",
  },
  options: [
    {
      title: "Reykjavik, Iceland",
      description: "Hot springs, aurora borealis, unique scenery",
      category: "Nature",
      pros: ["Scenic landscapes", "Memorable activities"],
      cons: ["Higher expenses"],
    },
    {
      title: "Kyoto, Japan",
      description: "Historic temples, incredible culinary scene, tranquil gardens",
      category: "Culture",
      pros: ["Rich culture", "World-class food"],
      cons: ["Long flight duration"],
    },
    {
      title: "Madeira, Portugal",
      description: "Subtropical climate, hiking trails, oceanfront views",
      category: "Nature",
      pros: ["Temperate climate", "Reasonable budget", "Direct flight availability"],
      cons: ["Smaller city center"],
    },
  ],
});

test.describe("Browser E2E: New Project Creation, Voting, and Results Pulling", () => {
  test("complete end-to-end user journey in browser", async ({ page }) => {
    test.setTimeout(90_000);
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // Step 1: Open Home Page
    await page.goto("./");
    await expect(page.getByRole("heading", { name: "Deci" }).first()).toBeVisible({
      timeout: 15_000,
    });

    let projectUrl = "";

    // Step 2: Create a New Project
    await test.step("Create new project via browser UI", async () => {
      await page.getByRole("link", { name: "+ New Decision Project" }).click();
      await expect(page.getByRole("textbox", { name: "Ideas or options JSON" })).toBeVisible();

      // Fill in options JSON
      await page.getByRole("textbox", { name: "Ideas or options JSON" }).fill(TEST_OPTIONS_PAYLOAD);

      // Use the parsed options
      const useOptionsButton = page.getByRole("button", { name: /^Use 3 options$/ });
      await expect(useOptionsButton).toBeVisible();
      await useOptionsButton.click();

      // Confirm title was populated
      const titleInput = page.locator("#project-title-input");
      await expect(titleInput).toHaveValue("Quarterly Team Offsite Destination");

      // Submit creation
      const createButton = page.getByRole("button", { name: "Create Project →" });
      await expect(createButton).toBeVisible();
      await createButton.click();

      // Verify redirection to project view
      await expect(
        page.getByRole("heading", { name: "Quarterly Team Offsite Destination" })
      ).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/#\/p\/file\/file_/);

      projectUrl = page.url();

      // Verify the 3 options are listed
      await expect(page.getByText("Reykjavik, Iceland")).toBeVisible();
      await expect(page.getByText("Kyoto, Japan")).toBeVisible();
      await expect(page.getByText("Madeira, Portugal")).toBeVisible();

      await checkA11y(page, "Project View Page");
    });

    // Step 3: Cast Ballot / Vote
    await test.step("Cast ranked ballot through voting screen", async () => {
      await page.goto(projectUrl);
      const voteLink = page.getByRole("link", { name: "Vote" });
      await voteLink.click();
      await page.waitForTimeout(1000);
      console.log("Console errors:", consoleErrors);
      console.log("URL after vote click:", page.url());
      console.log("Body text snippet:", (await page.locator("body").innerText()).slice(0, 300));

      await expect(page.getByText(/Rank Your Top 3 Options/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("heading", { name: "Ballot / Voting" })).toBeVisible();

      // Submit the ballot with initial ranking
      const submitBallotBtn = page.getByRole("button", { name: "Submit Ballot" });
      await expect(submitBallotBtn).toBeVisible();
      await submitBallotBtn.click();

      // Confirm successful ballot submission
      await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();
      await checkA11y(page, "Ballot Voting Page");
    });

    // Step 4: Pull and Tally Results
    await test.step("Navigate to Results screen, pull tally, and verify outcome", async () => {
      await page.goto(projectUrl);
      const resultsLink = page.getByRole("link", { name: "Results" });
      await expect(resultsLink).toBeVisible();
      await resultsLink.click();

      await expect(page.getByRole("heading", { name: "Decision Outcome & Results" })).toBeVisible({
        timeout: 10_000,
      });

      // Run decision strategy (e.g. Borda count)
      const decideBtn = page.getByRole("button", { name: /^Decide with / });
      await expect(decideBtn).toBeVisible();
      await decideBtn.click();

      // Confirm winner calculation
      await expect(page.getByText(/Decision executed: Winner is/)).toBeVisible({
        timeout: 10_000,
      });

      // Confirm winner card renders round winner and ranked order
      await expect(page.getByText(/Round 1 Winner/i)).toBeVisible();
      await expect(page.getByText("Final Ranked Order & Points")).toBeVisible();
      await expect(page.getByText("Ranked by:")).toBeVisible();

      // Verify outcome reproducibility using "Verify Outcome"
      const verifyButton = page.getByRole("button", { name: "Verify Outcome" });
      await expect(verifyButton).toBeVisible();
      await verifyButton.click();

      await expect(page.getByText("Reproduced ✓")).toBeVisible({ timeout: 5_000 });
      await checkA11y(page, "Decision Results Page");
    });

    expect(consoleErrors).toEqual([]);
  });
});
