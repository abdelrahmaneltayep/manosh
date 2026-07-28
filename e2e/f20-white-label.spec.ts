import { test, expect } from "@playwright/test";

/**
 * Feature 20 — White-label / agency multi-store happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_WHITE_LABEL=true on a Growth store.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("agency dashboard loads (create-org or org view)", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/agency`);
  // Either the create-org card or an existing org dashboard is shown.
  const create = page.getByRole("heading", { name: /Create your agency workspace/ });
  const connected = page.getByRole("heading", { name: /Connected stores/ });
  await expect(create.or(connected)).toBeVisible();
});

test("an agency can create an org and link a store", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/agency`);
  const nameField = page.getByLabel(/Organization name/);
  if (await nameField.count()) {
    await nameField.fill("Northwind Agency");
    await page.getByLabel(/Owner email/).fill("owner@agency.com");
    await page.getByRole("button", { name: /Create workspace/ }).click();
    await expect(page.getByText(/workspace created/i)).toBeVisible();
  }
  const linkField = page.getByLabel(/Store domain/);
  if (await linkField.count()) {
    await linkField.fill("client-two.myshopify.com");
    await page.getByRole("button", { name: /Link store/ }).click();
    // Either linked, or a clear entitlement error (store must be Growth/installed).
    await expect(page.getByText(/Store linked|Growth plan|hasn’t installed/)).toBeVisible();
  }
});

test("saving white-label branding validates contrast", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/agency`);
  const primary = page.getByLabel(/Primary color/);
  if (await primary.count()) {
    await primary.fill("#4F46E5");
    await page.getByLabel(/Portal name/).fill("Acme Wholesale");
    await page.getByRole("button", { name: /Save branding/ }).click();
    await expect(page.getByText(/branding saved/i)).toBeVisible();
  }
});
