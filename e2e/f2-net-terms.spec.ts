import { test, expect } from "@playwright/test";

/**
 * Feature 2 — Net Terms + Credit happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with a Growth-plan session and MANNON_FF_CREDIT=true:
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 *
 * Needs seed data: a company, a buyer with a valid magic-link session, and an
 * accepted net-terms order that has raised an invoice (INVOICE_ID).
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const INVOICE_ID = process.env.INVOICE_ID ?? "seed-invoice";

test("merchant sees the aging dashboard and can set a credit profile", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/credit`);
  await expect(page.getByRole("heading", { name: "Aging" })).toBeVisible();
  await expect(page.getByText(/Current/)).toBeVisible();

  // Set a credit profile.
  await page.getByLabel("Credit limit").fill("5000");
  await page.getByRole("button", { name: /Save profile/ }).click();
  await expect(page.getByText(/Credit profile saved/)).toBeVisible();
});

test("buyer sees an invoice with a due date and can open the printable PDF", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/invoices`);
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

  await page.goto(`${BASE_URL}/portal/invoices/${INVOICE_ID}`);
  await expect(page.getByText(/Due date/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Download PDF/ })).toBeVisible();
});

test("the reminder cron requires the shared secret", async ({ request }) => {
  const noSecret = await request.post(`${BASE_URL}/internal/cron/reminders`);
  expect([401, 503]).toContain(noSecret.status());
});
