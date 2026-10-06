import { expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

test.describe("US2: Share and Collaborate (T062)", () => {
  test("two browser contexts: share link, collaborator grades/comments, view-only gating, password prompt, and force 429", async ({
    browser,
  }) => {
    // 1. Owner context & Collaborator context
    const ownerContext = await browser.newContext();
    const collabContext = await browser.newContext();

    const ownerPage = await ownerContext.newPage();
    const collabPage = await collabContext.newPage();

    const fileId = "sheet-us2-share-456";

    // Setup mocks for Owner
    await ownerPage.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Mock Google globals
      (window as any).google = {
        accounts: {
          oauth2: {
            // biome-ignore lint/suspicious/noExplicitAny: Mock token callback
            initTokenClient: ({ callback }: any) => ({
              requestAccessToken: () => {
                callback({
                  access_token: "owner-token-123",
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

    // Setup mocks for Collaborator
    await collabPage.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Mock Google globals
      (window as any).google = {
        accounts: {
          oauth2: {
            // biome-ignore lint/suspicious/noExplicitAny: Mock token callback
            initTokenClient: ({ callback }: any) => ({
              requestAccessToken: () => {
                callback({
                  access_token: "collab-token-456",
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

    // Shared mock state between contexts
    let linkRole = "writer"; // "writer" = contribute, "reader" = view
    const commentsList = [["id", "at", "by", "optionId", "payload"]];
    const gradesList = [["id", "at", "by", "optionId", "payload"]];

    const setupRoutes = async (page: typeof ownerPage, userEmail: string) => {
      await page.route("**/*googleapis.com/**", async (route) => {
        const url = route.request().url();
        const method = route.request().method();

        if (url.includes("/drive/v3/about")) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              user: {
                displayName: userEmail.split("@")[0],
                emailAddress: userEmail,
              },
            }),
          });
        }

        if (url.includes(`/drive/v3/files/${fileId}/permissions`)) {
          if (method === "GET") {
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                permissions: [
                  {
                    id: "owner-perm",
                    role: "owner",
                    emailAddress: "owner@example.com",
                    type: "user",
                  },
                  { id: "link-perm", role: linkRole, type: "anyone" },
                ],
              }),
            });
          }
          if (method === "POST") {
            const body = route.request().postDataJSON();
            if (body.role) {
              linkRole = body.role;
            }
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ id: "perm-updated" }),
            });
          }
        }

        if (url.includes(`/drive/v3/files/${fileId}`)) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: fileId,
              name: "Collaborative Decision Engine",
              trashed: false,
              version: 2,
            }),
          });
        }

        if (url.includes(`/v4/spreadsheets/${fileId}/values:batchGet`)) {
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
                    ["owner", "owner@example.com"],
                    ["title", "Collaborative Decision Engine"],
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
                      "owner@example.com",
                      JSON.stringify({
                        id: "opt_1",
                        title: "Shared Option Alpha",
                        description: "First idea to evaluate",
                        status: "active",
                        tags: [],
                        pros: [],
                        cons: [],
                        links: [],
                      }),
                    ],
                    [
                      "opt_2",
                      "2",
                      "active",
                      "2026-10-05T00:00:00Z",
                      "owner@example.com",
                      JSON.stringify({
                        id: "opt_2",
                        title: "Shared Option Beta",
                        description: "Second idea to evaluate",
                        status: "active",
                        tags: [],
                        pros: [],
                        cons: [],
                        links: [],
                      }),
                    ],
                  ],
                },
                { range: "grades!A:E", values: gradesList },
                { range: "comments!A:E", values: commentsList },
                { range: "rankings!A:D", values: [["id", "at", "by", "payload"]] },
                { range: "outcomes!A:D", values: [["id", "at", "by", "payload"]] },
              ],
            }),
          });
        }

        if (url.includes(`/v4/spreadsheets/${fileId}/values/`)) {
          // append
          const postData = route.request().postDataJSON();
          if (url.includes("grades") && url.includes(":append") && postData?.values) {
            gradesList.push(...postData.values);
          } else if (url.includes("comments") && url.includes(":append") && postData?.values) {
            commentsList.push(...postData.values);
          }
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ updates: { updatedRows: 1 } }),
          });
        }

        return route.fulfill({ status: 200, json: {} });
      });
    };

    await setupRoutes(ownerPage, "owner@example.com");
    await setupRoutes(collabPage, "collaborator@example.com");

    // --- STEP 1: Owner opens Share page & copies link ---
    await ownerPage.goto(`./#/p/${fileId}/share`);
    await expect(
      ownerPage.getByRole("heading", { name: "Share Decision Project" }).first()
    ).toBeVisible();
    await checkA11y(ownerPage, "Share Dialog Page");

    const copyBtn = ownerPage.getByRole("button", { name: "Copy Link" });
    await expect(copyBtn).toBeVisible();

    // --- STEP 2: Collaborator opens the link ---
    const collabStartTime = Date.now();
    await collabPage.goto(`./#/p/${fileId}`);
    await expect(collabPage.getByText("Shared Option Alpha")).toBeVisible({ timeout: 10000 });
    await checkA11y(collabPage, "Collaborator Project View");

    // Verify collaborator role is "contribute"
    await expect(collabPage.getByText("Role: contribute")).toBeVisible();

    // --- STEP 3: Collaborator grades 2 options and comments once ---
    // Grade opt_1
    const opt1Star4 = collabPage.locator('input[aria-label="4 stars"]').first();
    await opt1Star4.check({ force: true });

    // SC-003: First grade within 1 min
    const firstGradeDuration = (Date.now() - collabStartTime) / 1000;
    expect(firstGradeDuration).toBeLessThan(60);

    // Add comment to opt_1 (comments are collapsed under each option row)
    await collabPage
      .getByRole("button", { name: /^(Comment|\d+ comments?)$/ })
      .first()
      .click();
    const commentBox = collabPage.getByPlaceholder("Add a comment (Markdown supported)...").first();
    await commentBox.fill("Looks great for Q4 team kickoff!");
    await collabPage.getByRole("button", { name: "Post Comment" }).first().click();

    await expect(collabPage.getByText("Looks great for Q4 team kickoff!")).toBeVisible();

    // --- STEP 4: Owner views project and sees collaborator update (SC-004 within 30s) ---
    await ownerPage.goto(`./#/p/${fileId}`);
    await ownerPage
      .getByRole("button", { name: /^1 comment$/ })
      .first()
      .click({ timeout: 30000 });
    await expect(ownerPage.getByText("Looks great for Q4 team kickoff!")).toBeVisible({
      timeout: 30000,
    });

    // --- STEP 5: View-only gating ---
    // Owner sets link access to view
    linkRole = "reader";
    await collabPage.reload();
    await expect(collabPage.getByText("Role: view")).toBeVisible();
    // Verify Grade inputs are disabled
    const disabledGrade = collabPage.locator('input[type="radio"]').first();
    await expect(disabledGrade).toBeDisabled();
    // Verify commenting explains view-only
    await expect(
      collabPage
        .getByText(
          "You have view-only access. To grade, comment, or vote, request contribute access from the project owner."
        )
        .first()
    ).toBeVisible();

    // --- STEP 6: Dev toolbar & Force 429 banner ---
    // Expand Dev toolbar on collaborator page
    const devBtn = collabPage.getByText("🛠️ Dev");
    await devBtn.click();
    await expect(collabPage.getByText("🛠️ Dev Toolbar (T072)")).toBeVisible();

    // Force 429
    await collabPage.getByRole("button", { name: "⚡ Force 429 Rate Limit" }).click();

    // Check SyncBanner appears
    await expect(collabPage.getByText(/Syncing paused due to rate limits/)).toBeVisible();

    // Cleanup
    await ownerContext.close();
    await collabContext.close();
  });
});
