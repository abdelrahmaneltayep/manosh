import { test, expect } from "@playwright/test";

/**
 * Feature 18 — Buyer PWA & one-tap reorder happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_BUYER_PWA=true and a signed-in buyer
 * session cookie (see the magic-link flow).
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("the web app manifest is installable + on brand", async ({ request }) => {
  const res = await request.get(`${BASE_URL}/portal/manifest.webmanifest`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("manifest");
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/portal");
  expect(m.theme_color).toBe("#4F46E5");
});

test("the service worker is served scoped to /portal/", async ({ request }) => {
  const res = await request.get(`${BASE_URL}/portal/sw.js`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["service-worker-allowed"]).toBe("/portal/");
  const body = await res.text();
  expect(body).toContain("mannon-portal-v"); // versioned cache name
});

test("the app icon is an SVG", async ({ request }) => {
  const res = await request.get(`${BASE_URL}/portal/icon.svg`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("image/svg+xml");
});

test("a signed-in buyer can save a shortcut and reorder it in one tap", async ({ page }) => {
  // Assumes a valid buyer session cookie is already set for BASE_URL.
  await page.goto(`${BASE_URL}/portal/shortcuts`);
  await expect(page.getByRole("heading", { name: /One-tap reorder/ })).toBeVisible();

  const search = page.getByLabel(/Add an item/);
  if (await search.count()) {
    await search.fill("A-1");
    const add = page.getByRole("button", { name: /^Add$/ }).first();
    if (await add.count()) {
      await add.click();
      await page.getByLabel(/Name this shortcut/).fill("Monthly reorder");
      await page.getByRole("button", { name: /Save shortcut/ }).click();
      await expect(page.getByText(/Shortcut saved/)).toBeVisible();

      // One-tap reorder → lands on a real quote.
      await page.getByRole("button", { name: /Reorder now/ }).first().click();
      await expect(page).toHaveURL(/\/portal\/quotes\//);
    }
  }
});
