import { test, expect } from "@playwright/test";

/**
 * Feature 4 — Bulk Order Pad happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_ORDERPAD=true and a buyer magic-link
 * session whose catalog contains SKUs A-1 and B-2:
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("paste populates rows with a live subtotal and flags a bad line", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/quick-order`);
  await page.getByPlaceholder("A-1, 5\nB-2, 2").fill("A-1, 5\nB-2, 2\nZZZ-9, 3");
  await page.getByRole("button", { name: /Add pasted lines/ }).click();

  // Cart shows the two matched lines + a subtotal; the unknown SKU is flagged.
  await expect(page.getByText(/Your order \(2 items\)/)).toBeVisible();
  await expect(page.getByText(/Subtotal/)).toBeVisible();
  await expect(page.getByText(/couldn.t be matched/i)).toBeVisible();
});

test("save + reorder a list", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/quick-order`);
  await page.getByPlaceholder("A-1, 5\nB-2, 2").fill("A-1, 5");
  await page.getByRole("button", { name: /Add pasted lines/ }).click();
  await page.getByPlaceholder("e.g. Monthly reorder").fill("My reorder");
  await page.getByRole("button", { name: /^Save list$/ }).click();
  await expect(page.getByText(/List saved/)).toBeVisible();

  await page.getByRole("button", { name: /^Reorder$/ }).first().click();
  await expect(page.getByText(/Your order/)).toBeVisible();
});

test("CSV upload box is hidden on a Starter store", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/portal/quick-order`);
  await expect(page.getByText(/CSV upload is available on the store.s Growth plan/)).toBeVisible();
});
