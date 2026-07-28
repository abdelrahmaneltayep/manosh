import { test, expect } from "@playwright/test";

/**
 * Feature 5 — Company Accounts happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_COMPANY_ACCOUNTS=true, an ADMIN member
 * magic-link session, and (for the approval test) an approver session + a
 * countered quote above the company threshold.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OVER_THRESHOLD_QUOTE = process.env.QUOTE_ID ?? "seed-quote";

test("admin invites a second member (Growth)", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/team`);
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await page.getByLabel("Email").fill("teammate@company.com");
  await page.getByRole("button", { name: /Send invite/ }).click();
  await expect(page.getByText(/Invited teammate@company.com/)).toBeVisible();
});

test("Starter is blocked at the second member", async ({ page }) => {
  // Run with a Starter store that already has one member.
  await page.goto(`${BASE_URL}/portal/team`);
  await expect(page.getByText(/Single buyer on Starter/)).toBeVisible();
});

test("an over-threshold order waits for approval, then an approver unblocks it", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/quotes/${OVER_THRESHOLD_QUOTE}`);
  await page.getByRole("button", { name: /Accept & create order/ }).click();
  await expect(page.getByText(/Waiting for approval/)).toBeVisible();

  // As an approver (separate session in the real run):
  await page.getByRole("button", { name: /Approve order/ }).click();
  await expect(page.getByText(/Order approved/)).toBeVisible();
});
