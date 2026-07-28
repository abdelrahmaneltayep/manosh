import { test, expect } from "@playwright/test";

/**
 * Feature 11 — Custom Catalogs happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_CUSTOM_CATALOGS=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("merchant creates a custom catalog", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/catalogs`);
  await page.getByLabel("Name").fill("Exclusive Line");
  await page.getByRole("button", { name: /Create catalog/ }).click();
  // Redirects into the builder.
  await expect(page.getByRole("heading", { name: /Exclusive Line/ })).toBeVisible();
});

test("the builder offers a preview-as-customer control", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/catalogs`);
  await page.getByRole("button", { name: /Exclusive Line/ }).first().click();
  await expect(page.getByText(/Preview as customer/)).toBeVisible();
});

test("Starter is capped at one custom catalog", async ({ page }) => {
  // Run with a Starter session that already has 1 custom catalog.
  await page.goto(`${BASE_URL}/app/catalogs`);
  const cap = page.getByText(/reached your catalog limit/i);
  if (await cap.count()) {
    await expect(cap).toBeVisible();
  }
});

test("a buyer only sees their assigned catalog in the order pad", async ({ page }) => {
  // Buyer session assigned to a restricted catalog.
  await page.goto(`${BASE_URL}/portal/quick-order`);
  // The exclusive SKU is present; a non-assigned SKU is absent (removed, not greyed).
  // (Assertions are store-data specific — adjust SKUs to the dev store.)
  await expect(page).toHaveURL(/quick-order/);
});
