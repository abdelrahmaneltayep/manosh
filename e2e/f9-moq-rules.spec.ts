import { test, expect } from "@playwright/test";

/**
 * Feature 9 — MOQ / Order Rules happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_MOQ=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("merchant creates a store minimum-order rule", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/order-rules`);
  await page.getByLabel("Min order value").first().fill("250");
  await page.getByRole("button", { name: /^Add rule$/ }).click();
  await expect(page.getByText(/250/)).toBeVisible();
});

test("the test-this-cart preview rounds a quantity up to the pack size", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/order-rules`);
  // Requires a case-of-12 product rule to already exist for this variant.
  await page.getByLabel("Variant id").last().fill("gid://shopify/ProductVariant/1");
  await page.getByLabel("Quantity").fill("20");
  await page.getByLabel("Unit price").fill("10");
  // The live preview reflects the rounded quantity when a pack rule applies.
  await expect(page.getByText(/24|rounded/i)).toBeVisible();
});

test("buyer order pad shows a minimum-order progress bar", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/quick-order`);
  await expect(page.getByText(/minimum|add \$/i)).toBeVisible();
});
