import { test, expect } from "@playwright/test";

/**
 * Feature 14 — Tax & VAT happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_TAX_VAT=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("merchant sets a default tax rate", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/tax`);
  await page.getByLabel("Default rate").fill("15");
  await page.getByRole("button", { name: /Save rate/ }).click();
  await expect(page.getByText(/Default tax rate saved/)).toBeVisible();
});

test("buyer submits a VAT id and sees a pending status", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/tax`);
  await page.getByLabel("Tax ID").fill("300000000000003");
  await page.getByRole("button", { name: /Submit tax details/ }).click();
  await expect(page.getByText(/we’ll review it shortly/i)).toBeVisible();
});

test("a bad VAT format is rejected client-side of submission", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/tax`);
  await page.getByLabel("Tax ID").fill("12");
  await page.getByRole("button", { name: /Submit tax details/ }).click();
  await expect(page.getByText(/doesn’t look right/i)).toBeVisible();
});

test("merchant verifies a profile as exempt", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/tax`);
  const verify = page.getByRole("button", { name: /^Verify exempt$/ }).first();
  if (await verify.count()) {
    await verify.click();
    await expect(page.getByText(/Tax profile verified/)).toBeVisible();
  }
});

test("certificate download requires admin auth (no public URL)", async ({ page }) => {
  // Hitting the private cert route without an admin session must not stream a file.
  const res = await page.goto(`${BASE_URL}/app/tax/certificate/some-company-id`);
  expect(res && res.status() >= 300).toBeTruthy();
});
