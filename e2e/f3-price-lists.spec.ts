import { test, expect } from "@playwright/test";

/**
 * Feature 3 — Price lists happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_PRICELISTS=true:
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 *
 * Needs a Growth-plan session for the volume-break / CSV / unlimited assertions,
 * and a buyer magic-link session with an assigned list for the portal check.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("merchant creates a price list and adds an entry", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/price-lists`);
  await page.getByLabel("Name").fill("Wholesale tier A");
  await page.getByRole("button", { name: /Create price list/ }).click();

  // Now on the editor.
  await page.getByLabel("Variant id").fill("gid://shopify/ProductVariant/1");
  await page.getByLabel("Price").first().fill("12.50");
  await page.getByRole("button", { name: /Add \/ update/ }).click();
  await expect(page.getByText(/Price saved/)).toBeVisible();
});

test("Starter is blocked at the 4th price list", async ({ page }) => {
  // With three lists already present on a Starter session:
  await page.goto(`${BASE_URL}/app/price-lists`);
  await expect(page.getByText(/Price-list limit reached/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Create price list/ })).toHaveCount(0);
});

test("buyer sees a custom price with a savings badge", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/quotes/new`);
  await expect(page.getByText(/You save/)).toBeVisible();
});
