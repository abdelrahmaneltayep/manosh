import { test, expect } from "@playwright/test";

/**
 * Feature 16 — Multi-Currency & Multi-Language happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_I18N=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("the portal offers a language switcher", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/signin`);
  await expect(page.getByRole("button", { name: "العربية" })).toBeVisible();
});

test("switching to Arabic flips the portal to RTL", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/signin`);
  await page.getByRole("button", { name: "العربية" }).click();
  const dir = await page.locator("main.portal").getAttribute("dir");
  expect(dir).toBe("rtl");
  await expect(page.locator("main.portal")).toHaveAttribute("lang", "ar");
});

test("merchant enables Arabic + an extra currency", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/i18n`);
  await page.getByLabel(/Extra currencies/).fill("SAR");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText(/settings saved/i)).toBeVisible();
});

test("merchant adds a fixed FX rate", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/i18n`);
  await page.getByLabel("Quote").fill("SAR");
  await page.getByLabel("Rate").fill("3.75");
  await page.getByRole("button", { name: /Add \/ update/ }).click();
  await expect(page.getByText(/Rate saved/)).toBeVisible();
});
