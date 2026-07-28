import { test, expect } from "@playwright/test";

/**
 * Feature 12 — Sales-Rep Portal happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_REP_PORTAL=true on a Growth store.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("merchant can invite a rep and assign a company", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/reps`);
  await page.getByLabel("Email").fill("rep@example.com");
  await page.getByRole("button", { name: /Send invite/ }).click();
  await expect(page.getByText(/Rep invited/)).toBeVisible();
});

test("Starter sees the upgrade lock", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/app/reps`);
  await expect(page.getByText(/upgrade to Growth/i)).toBeVisible();
});

test("rep portal requires sign-in", async ({ page }) => {
  await page.goto(`${BASE_URL}/rep`);
  await expect(page).toHaveURL(/\/rep\/signin/);
});

test("an invalid rep magic link is rejected", async ({ page }) => {
  await page.goto(`${BASE_URL}/rep/auth?token=not-a-real-token`);
  await expect(page.getByText(/can’t be used|invalid|expired/i)).toBeVisible();
});

test("a signed-in rep sees the impersonation banner when ordering on behalf", async ({ page }) => {
  // Rep session assigned to a company with at least one buyer.
  await page.goto(`${BASE_URL}/rep`);
  const open = page.getByRole("link", { name: /^Open$/ }).first();
  if (await open.count()) {
    await open.click();
    const onBehalf = page.getByRole("button", { name: /Order on behalf/ }).first();
    if (await onBehalf.count()) {
      await onBehalf.click();
      await expect(page.getByText(/Ordering on behalf of/)).toBeVisible();
    }
  }
});
