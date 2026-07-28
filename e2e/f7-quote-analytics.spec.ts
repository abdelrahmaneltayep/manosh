import { test, expect } from "@playwright/test";

/**
 * Feature 7 — Quote Analytics happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_QUOTE_ANALYTICS=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("Growth merchant with history sees KPIs and can switch range", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/analytics`);
  await expect(page.getByText("Win rate")).toBeVisible();
  await expect(page.getByText("Avg discount")).toBeVisible();
  await expect(page.getByText("Open pipeline")).toBeVisible();

  await page.getByRole("button", { name: "90 days" }).click();
  await expect(page).toHaveURL(/range=90/);
  await expect(page.getByText(/Last 90 days/)).toBeVisible();
});

test("CSV export link is present", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/analytics`);
  await expect(page.getByRole("link", { name: /Export CSV/ })).toBeVisible();
});

test("Starter sees the locked preview", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/app/analytics`);
  await expect(page.getByText(/Quote analytics is a Growth feature/)).toBeVisible();
});
