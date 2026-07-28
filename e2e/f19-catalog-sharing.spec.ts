import { test, expect } from "@playwright/test";

/**
 * Feature 19 — Catalog sharing & B2B discovery happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_CATALOG_SHARE=true and a published,
 * live public catalog at the slug below.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SHOP = process.env.DEV_SHOP ?? "example.myshopify.com";
const SLUG = process.env.PUBLIC_CATALOG_SLUG ?? "spring-2026-wholesale";

test("the public catalog page renders + hides prices by default", async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/catalog/${SHOP}/${SLUG}`);
  if (res && res.status() === 404) test.skip(true, "No live public catalog seeded");
  await expect(page.getByRole("heading", { name: /Request wholesale access/ })).toBeVisible();
  // Prices are hidden by default → the "Price on approval" affordance is present.
  await expect(page.getByText(/Price on approval/).first()).toBeVisible();
});

test("a visitor can request access", async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/catalog/${SHOP}/${SLUG}`);
  if (res && res.status() === 404) test.skip(true, "No live public catalog seeded");
  await page.getByLabel(/Work email/).fill("newbuyer@example.com");
  await page.getByLabel(/Company name/).fill("New Buyer Co");
  await page.getByRole("button", { name: /Request access/ }).click();
  await expect(page.getByText(/Request sent/)).toBeVisible();
});

test("the discovery index loads", async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/discover`);
  if (res && res.status() === 404) test.skip(true, "Catalog sharing flag off");
  await expect(page.getByRole("heading", { name: /Wholesale catalogs/ })).toBeVisible();
});

test("a merchant approves a request → buyer provisioned", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/catalog-sharing`);
  const approve = page.getByRole("button", { name: /^Approve$/ }).first();
  if (await approve.count()) {
    await approve.click();
    await expect(page.getByText(/emailed a secure link/)).toBeVisible();
  }
});
