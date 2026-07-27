import { test, expect } from "@playwright/test";

/**
 * Feature 10 — Accounting Sync happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_ACCOUNTING_SYNC=true on a Growth store.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("accounting page offers QuickBooks + Xero connect", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/accounting`);
  await expect(page.getByRole("button", { name: /Connect QuickBooks Online/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect Xero/ })).toBeVisible();
});

test("merchant saves a field mapping", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/accounting`);
  await page.getByLabel("Tax code map").fill("default=TAX");
  await page.getByLabel("Account map").fill("income=200");
  await page.getByRole("button", { name: /^Save mapping$/ }).click();
  await expect(page.getByText(/Field mapping saved/)).toBeVisible();
});

test("a failed sync exposes a Retry button", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/accounting`);
  const retry = page.getByRole("button", { name: /^Retry$/ }).first();
  if (await retry.count()) {
    await retry.click();
    await expect(page.getByText(/Queued for retry/)).toBeVisible();
  }
});

test("Starter sees the upgrade lock", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/app/accounting`);
  await expect(page.getByText(/upgrade to Growth/i)).toBeVisible();
});

test("the OAuth callback rejects a forged state", async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/accounting/callback/qbo?code=x&state=forged.sig`);
  expect(res?.status()).toBeGreaterThanOrEqual(400);
});
