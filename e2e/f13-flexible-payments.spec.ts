import { test, expect } from "@playwright/test";

/**
 * Feature 13 — Flexible Payments happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_FLEX_PAY=true on a Growth store.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("Starter sees the upgrade lock", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/app/payments`);
  await expect(page.getByText(/upgrade to Growth/i)).toBeVisible();
});

test("merchant sets a default deposit policy", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/payments`);
  await page.getByLabel("Default deposit %").fill("30");
  await page.getByRole("button", { name: /Save policy/ }).click();
  await expect(page.getByText(/Default deposit policy saved/)).toBeVisible();
});

test("merchant creates a 30% deposit plan and issues a pay-link", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/payments`);
  const setup = page.getByRole("link", { name: /Set up plan/ }).first();
  if (await setup.count()) {
    await setup.click();
    await page.getByLabel("Deposit %").fill("30");
    await page.getByRole("button", { name: /Create plan/ }).click();
    await expect(page.getByText(/Payment plan created/)).toBeVisible();
    await page.getByRole("button", { name: /Create pay-by-link/ }).click();
    await expect(page.getByText(/Pay-by-link created/)).toBeVisible();
  }
});

test("an invalid pay-link token 404s", async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/pay/not-a-real-token`);
  expect(res?.status()).toBe(404);
});
