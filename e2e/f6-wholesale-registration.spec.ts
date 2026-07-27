import { test, expect } from "@playwright/test";

/**
 * Feature 6 — Wholesale Registration happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_WHOLESALE_REG=true and a published form.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SHOP = process.env.SHOP ?? "demo.myshopify.com";

test("a buyer submits the public application form", async ({ page }) => {
  await page.goto(`${BASE_URL}/apply/${SHOP}`);
  await expect(page.getByText(/Apply to buy wholesale/)).toBeVisible();
  await page.getByLabel(/Company name/i).fill("Acme Retail");
  await page.getByLabel(/Contact email/i).fill("buyer@acme.com");
  await page.getByRole("button", { name: /Submit application/ }).click();
  await expect(page.getByText(/Application received|approved/i)).toBeVisible();
});

test("merchant sees the application in the queue and approves it", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/wholesale`);
  await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
  await page.getByRole("button", { name: /^Approve$/ }).first().click();
  await expect(page.getByText(/Application approved/)).toBeVisible();
});

test("Starter is blocked from adding a second form", async ({ page }) => {
  // Run with a Starter store that already has one form.
  await page.goto(`${BASE_URL}/app/wholesale`);
  await expect(page.getByText(/wholesale form/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add form$/ })).toHaveCount(0);
});
