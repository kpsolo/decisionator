import { expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

test.describe("US1: Create, Format, Grade, and Delete Project (T038)", () => {
  test("full quickstart US1 flow under 3 min with fake Google and a11y checks", async ({
    page,
  }) => {
    const startTime = Date.now();

    // 1. Navigate to Home
    await page.goto("./");
    await expect(page.getByText("My Decision Projects")).toBeVisible();
    await checkA11y(page, "Home Page");

    // 2. Click + New Decision Project
    await page.getByRole("link", { name: "+ New Decision Project" }).click();
    await expect(page.getByText("Step 1: Paste Your Ideas")).toBeVisible();
    await checkA11y(page, "New Project - Paste Step");

    // 3. Paste 10 lines of ideas
    const sampleIdeas = [
      "1. Automated daily sync — AI summaries",
      "2. Weekly retrospective board with voting",
      "3. Micro-surveys after major releases",
      "4. Centralized documentation hub",
      "5. Pair programming rotation calendar",
      "6. Incident post-mortem repository",
      "7. Architecture review request queue",
      "8. Continuous dependency vulnerability alerts",
      "9. Flaky test dashboard and isolation",
      "10. Hackathon project ideation board",
    ].join("\n");

    const textarea = page.locator("textarea");
    await textarea.fill(sampleIdeas);

    // 4. Use as plain list
    await page.getByRole("button", { name: "Use as plain list" }).click();
    await expect(page.getByText("Step 3: Review & Edit Project")).toBeVisible();
    await checkA11y(page, "New Project - Preview Step");

    // Check that 10 options were generated
    await expect(page.getByText("Options (10)")).toBeVisible();

    // 5. Fill project title
    const titleInput = page.locator("#project-title-input");
    await titleInput.fill("Engineering Productivity Q4");

    // 6. Confirm and create project
    // Setup mock Google OAuth & Sheets API in browser context
    await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Mocking browser global
      (window as any).google = {
        accounts: {
          oauth2: {
            // biome-ignore lint/suspicious/noExplicitAny: Mocking token callback
            initTokenClient: ({ callback }: any) => ({
              requestAccessToken: () => {
                callback({
                  access_token: "fake-access-token",
                  expires_in: 3600,
                  scope: "https://www.googleapis.com/auth/drive.file",
                  token_type: "Bearer",
                });
              },
            }),
          },
        },
      };
    });

    // Mock API requests for Google Drive & Sheets
    await page.route("**/*googleapis.com/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/drive/v3/about")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: { displayName: "Alice Engineer", emailAddress: "alice@example.com" },
          }),
        });
      }
      if (url.includes("/v4/spreadsheets") && route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ spreadsheetId: "sheet-us1-test-123" }),
        });
      }
      if (url.includes("/drive/v3/files/sheet-us1-test-123/permissions")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            permissions: [{ role: "owner", emailAddress: "alice@example.com" }],
          }),
        });
      }
      if (url.includes("/drive/v3/files/sheet-us1-test-123")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "sheet-us1-test-123",
            name: "Engineering Productivity Q4",
            trashed: false,
          }),
        });
      }
      if (url.includes("/v4/spreadsheets/sheet-us1-test-123/values:batchUpdate")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ responses: [] }),
        });
      }
      if (url.includes("/v4/spreadsheets/sheet-us1-test-123/values:batchGet")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            valueRanges: [
              {
                range: "meta!A:B",
                values: [
                  ["key", "value"],
                  ["formatVersion", "1"],
                  ["owner", "alice@example.com"],
                  ["title", "Engineering Productivity Q4"],
                  ["protected", "false"],
                ],
              },
              {
                range: "options!A:F",
                values: [
                  ["id", "order", "status", "at", "by", "payload"],
                  [
                    "opt_1",
                    "1",
                    "active",
                    "2026-10-05T00:00:00Z",
                    "alice@example.com",
                    JSON.stringify({
                      id: "opt_1",
                      title: "Automated daily sync",
                      description: "AI summaries",
                      status: "active",
                      tags: [],
                      pros: [],
                      cons: [],
                      links: [],
                    }),
                  ],
                ],
              },
              { range: "grades!A:E", values: [["id", "at", "by", "optionId", "payload"]] },
              { range: "comments!A:E", values: [["id", "at", "by", "optionId", "payload"]] },
              { range: "rankings!A:D", values: [["id", "at", "by", "payload"]] },
              { range: "outcomes!A:D", values: [["id", "at", "by", "payload"]] },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, json: {} });
    });

    await page.getByRole("button", { name: "Create Project →" }).click();

    // 7. Verify Navigation to Project overview
    await expect(page.getByText("Engineering Productivity Q4")).toBeVisible({ timeout: 10000 });
    await checkA11y(page, "Project Overview Page");

    // Check options & rating
    await expect(page.getByText("Automated daily sync")).toBeVisible();
    await expect(page.getByText("Options & Grading")).toBeVisible();

    // Check Stats tab
    await page.getByRole("button", { name: "Statistics & Distributions" }).click();
    await expect(page.getByText("Project Statistics & Distributions")).toBeVisible();
    await checkA11y(page, "Project Stats View");

    // 8. Delete project flow (confirm by typing title)
    await page.getByRole("button", { name: "Delete Project..." }).click();
    await expect(page.getByText("Delete Decision Project")).toBeVisible();
    await checkA11y(page, "Delete Project Dialog");

    const deleteInput = page.getByPlaceholder("Engineering Productivity Q4");
    await deleteInput.fill("Engineering Productivity Q4");

    const deleteConfirmBtn = page.getByRole("button", { name: "Permanently Delete" });
    await expect(deleteConfirmBtn).toBeEnabled();
    await deleteConfirmBtn.click();

    // Verify redirected back to home
    await expect(page.getByText("My Decision Projects")).toBeVisible();

    // SC-001 timing gate: under 3 minutes
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    expect(elapsedSeconds).toBeLessThan(180);
  });
});
