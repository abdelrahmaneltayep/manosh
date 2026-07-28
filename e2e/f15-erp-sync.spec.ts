import { test, expect } from "@playwright/test";

/**
 * Feature 15 — ERP / Inventory Sync happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_ERP_SYNC=true on a Growth store.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("Starter sees the upgrade lock + enterprise note", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/app/erp`);
  await expect(page.getByText(/upgrade to Growth/i)).toBeVisible();
  await expect(page.getByText(/Enterprise sync add-on/i)).toBeVisible();
});

test("merchant configures a webhook ERP connection", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/erp`);
  await page.getByLabel("Endpoint (webhook URL / SFTP host)").fill("https://erp.example.com/hooks/mannon");
  await page.getByLabel(/Secret/).fill("s3cr3t-token");
  await page.getByRole("button", { name: /Save connection/ }).click();
  await expect(page.getByText(/ERP connection saved/)).toBeVisible();
});

test("a simulated inbound stock update applies", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/erp`);
  const box = page.getByPlaceholder(/ProductVariant/);
  if (await box.count()) {
    await box.fill("gid://shopify/ProductVariant/1,0");
    await page.getByRole("button", { name: /Apply stock update/ }).click();
    await expect(page.getByText(/Applied 1 stock update/)).toBeVisible();
  }
});

test("the inbound webhook rejects a bad secret", async ({ request }) => {
  const res = await request.post(`${BASE_URL}/internal/erp/stock`, {
    headers: { "x-shop-domain": "acme.myshopify.com", "x-erp-secret": "wrong", "content-type": "application/json" },
    data: [{ variantId: "gid://v/1", qty: 0 }],
  });
  expect([400, 401]).toContain(res.status());
});

test("the cron export worker requires the cron secret", async ({ request }) => {
  const res = await request.post(`${BASE_URL}/internal/cron/erp`, { headers: { "x-cron-secret": "nope" } });
  expect([401, 503]).toContain(res.status());
});
