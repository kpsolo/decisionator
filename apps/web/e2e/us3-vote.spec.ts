import { expect, test } from "@playwright/test";
import { checkA11y } from "./fixtures/axe.js";

test.describe("US3: Ranked Vote and Results (T074)", () => {
  test("quickstart US3 steps 1–5: submit ballot, re-vote replaces, owner closes, tie-break, verify outcome, reopen round 2", async ({
    page,
  }) => {
    const fileId = "sheet-us3-vote-789";

    // Setup mocks
    await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Mock Google globals
      (window as any).google = {
        accounts: {
          oauth2: {
            // biome-ignore lint/suspicious/noExplicitAny: Mock token callback
            initTokenClient: ({ callback }: any) => ({
              requestAccessToken: () => {
                callback({
                  access_token: "mock-token-us3",
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

    // Mock project state
    let votingState = {
      state: "open",
      round: 1,
      topN: 3,
      liveResults: true,
    };

    const rankingsList = [["id", "at", "by", "payload"]];

    const outcomesList = [["id", "at", "by", "payload"]];

    await page.route("https://www.googleapis.com/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes("/drive/v3/about")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: { displayName: "Owner User", emailAddress: "owner@example.com" },
          }),
        });
      }

      if (url.includes(`/drive/v3/files/${fileId}/permissions`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            permissions: [
              { id: "owner-p", role: "owner", emailAddress: "owner@example.com", type: "user" },
            ],
          }),
        });
      }

      if (url.includes(`/drive/v3/files/${fileId}`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: fileId,
            name: "US3 Decision Process",
            trashed: false,
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
                  ["title", "US3 Decision Process"],
                  ["protected", "false"],
                  ["voting", JSON.stringify(votingState)],
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
                      title: "Product Roadmap Initiative A",
                      description: "Strategic plan A",
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
                      title: "Product Roadmap Initiative B",
                      description: "Strategic plan B",
                      status: "active",
                      tags: [],
                      pros: [],
                      cons: [],
                      links: [],
                    }),
                  ],
                  [
                    "opt_3",
                    "3",
                    "active",
                    "2026-10-05T00:00:00Z",
                    "owner@example.com",
                    JSON.stringify({
                      id: "opt_3",
                      title: "Product Roadmap Initiative C",
                      description: "Strategic plan C",
                      status: "active",
                      tags: [],
                      pros: [],
                      cons: [],
                      links: [],
                    }),
                  ],
                ],
              },
              {
                range: "grades!A:E",
                values: [
                  ["id", "at", "by", "optionId", "payload"],
                  [
                    "g1",
                    "2026-10-05T01:00:00Z",
                    "owner@example.com",
                    "opt_1",
                    JSON.stringify({ value: 5 }),
                  ],
                  [
                    "g2",
                    "2026-10-05T01:00:00Z",
                    "owner@example.com",
                    "opt_2",
                    JSON.stringify({ value: 4 }),
                  ],
                ],
              },
              { range: "comments!A:E", values: [["id", "at", "by", "optionId", "payload"]] },
              { range: "rankings!A:D", values: rankingsList },
              { range: "outcomes!A:D", values: outcomesList },
            ],
          }),
        });
      }

      if (url.includes(`/v4/spreadsheets/${fileId}/values:batchUpdate`)) {
        const postData = route.request().postDataJSON();
        for (const upd of postData.data || []) {
          if (upd.range === "meta!B6") {
            votingState = JSON.parse(upd.values[0][0]);
          }
        }
        return route.fulfill({ status: 200, json: { responses: [] } });
      }

      if (url.includes(`/v4/spreadsheets/${fileId}/values/`)) {
        const postData = route.request().postDataJSON();
        if (url.includes("rankings:append") && postData.values) {
          rankingsList.push(...postData.values);
        } else if (url.includes("outcomes:append") && postData.values) {
          outcomesList.push(...postData.values);
        }
        return route.fulfill({ status: 200, json: { updates: { updatedRows: 1 } } });
      }

      return route.fulfill({ status: 200, json: {} });
    });

    // --- STEP 1: Navigate to Vote screen ---
    await page.goto(`./#/p/${fileId}/vote`);
    await expect(page.getByText("Rank Your Top 3 Options")).toBeVisible();
    await checkA11y(page, "Ballot Voting Screen");

    // Submit initial ballot
    const submitBtn = page.getByRole("button", { name: "Submit Ballot" });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();
    await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();

    // Re-vote replaces ballot (change order via keyboard)
    const moveDownBtn = page.locator('button[aria-label="Move Product Roadmap Initiative A down"]');
    await moveDownBtn.click();
    const updateBtn = page.getByRole("button", { name: "Update Ballot" });
    await updateBtn.click();
    await expect(page.getByText("Ballot submitted successfully!")).toBeVisible();

    // --- STEP 2: Owner closes voting and tallies results ---
    const closeVotingBtn = page.getByRole("button", { name: "Close Voting & Tally Results" });
    await expect(closeVotingBtn).toBeVisible();
    await closeVotingBtn.click();

    // --- STEP 3: Navigate to Results screen ---
    await page.goto(`./#/p/${fileId}/results`);
    await expect(page.getByText(/Round 1 Winner/)).toBeVisible();
    await checkA11y(page, "Results Screen");

    // Check Verify Button reproduces outcome (SC-006)
    const verifyBtn = page.getByRole("button", { name: "Verify Outcome" });
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();
    await expect(page.getByText("Reproduced ✓")).toBeVisible();

    // --- STEP 4: Return to Vote screen and reopen Round 2 ---
    await page.goto(`./#/p/${fileId}/vote`);
    await expect(page.getByText("● Voting is CLOSED")).toBeVisible();

    const openRound2Btn = page.getByRole("button", { name: "Open Round 2" });
    await expect(openRound2Btn).toBeVisible();
    await openRound2Btn.click();

    await expect(page.getByText("● Voting is OPEN")).toBeVisible();
    await expect(page.getByText("Voting Controls — Round 2")).toBeVisible();
  });
});
