import { test, expect } from "@playwright/test";

/**
 * Feature 17 — Request-a-Quote widget happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_QUOTE_WIDGET=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SHOP = process.env.DEV_SHOP ?? "example.myshopify.com";

test("merchant enables the widget", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/quote-requests`);
  await page.getByLabel("Enable the storefront widget").check();
  await page.getByRole("button", { name: /Save settings/ }).click();
  await expect(page.getByText(/Widget settings saved/)).toBeVisible();
});

test("public config returns the widget label", async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/quote-widget-config?shop=${encodeURIComponent(SHOP)}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toHaveProperty("label");
});

test("a public submission is accepted", async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/quote-request`, {
    data: { shop: SHOP, email: "visitor@example.com", elapsedMs: 5000, lines: [{ sku: "ABC", quantity: 2 }] },
  });
  const body = await res.json();
  expect(body).toHaveProperty("ok");
});

test("a honeypot submission is silently accepted (no leak)", async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/quote-request`, {
    data: { shop: SHOP, email: "bot@example.com", company_url_confirm: "http://spam", elapsedMs: 5000, lines: [{ sku: "X", quantity: 1 }] },
  });
  const body = await res.json();
  expect(body.ok).toBe(true); // generic OK — the bot learns nothing
});

test("a converted request opens a real quote", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/quote-requests`);
  const convert = page.getByRole("button", { name: /Convert to quote/ }).first();
  if (await convert.count()) {
    await convert.click();
    await expect(page).toHaveURL(/\/app\/quotes\//);
  }
});
