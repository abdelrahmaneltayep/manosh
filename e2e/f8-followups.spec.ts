import { test, expect } from "@playwright/test";

/**
 * Feature 8 — Follow-ups happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with MANNON_FF_FOLLOWUPS=true.
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test("merchant enables a follow-up policy", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/followups`);
  await page.getByLabel("Automatically follow up on open quotes").check();
  await page.getByLabel("Expire quotes after (days)").fill("14");
  await page.getByRole("button", { name: /Save policy/ }).click();
  await expect(page.getByText(/Follow-up policy saved/)).toBeVisible();
});

test("Send now works from the needs-a-nudge list", async ({ page }) => {
  await page.goto(`${BASE_URL}/app/followups`);
  const send = page.getByRole("button", { name: /^Send now$/ }).first();
  if (await send.count()) {
    await send.click();
    await expect(page.getByText(/Reminder sent/)).toBeVisible();
  }
});

test("Starter sees the single-reminder note", async ({ page }) => {
  // Run with a Starter session.
  await page.goto(`${BASE_URL}/app/followups`);
  await expect(page.getByText(/Starter sends a/)).toBeVisible();
});

test("an unsubscribe link with a bad token is rejected", async ({ page }) => {
  await page.goto(`${BASE_URL}/portal/unsubscribe/some-quote?t=bad`);
  await expect(page.getByText(/Link not valid/)).toBeVisible();
});
