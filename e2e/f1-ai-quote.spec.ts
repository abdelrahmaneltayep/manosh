import { test, expect } from "@playwright/test";

/**
 * Feature 1 — AI Quote Assistant happy path (Playwright).
 *
 * NOT collected by `npm test` (vitest only includes app/** and prisma/**). Run
 * against a running app with a Growth-plan session and MANNON_FF_AI_QUOTE=true:
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx playwright test e2e/
 *
 * Requires an authenticated embedded session (the CI harness injects the
 * App Bridge session token) and a seeded SUBMITTED quote id in QUOTE_ID.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const QUOTE_ID = process.env.QUOTE_ID ?? "seed-quote";

test("merchant gets an AI suggestion and accepts it into the counter field", async ({
  page,
}) => {
  await page.goto(`${BASE_URL}/app/quotes/${QUOTE_ID}`);

  // The per-line AI suggest control is visible for a Growth merchant.
  const suggest = page.getByRole("button", { name: /AI suggest/i }).first();
  await expect(suggest).toBeVisible();

  await suggest.click();

  // The suggestion panel appears with a price, a margin read, and a draft message.
  await expect(page.getByText(/AI suggests \$/)).toBeVisible();
  await expect(page.getByText(/Draft message to buyer/)).toBeVisible();

  // Accept prefills the unit-price field, then the counter can be sent.
  await page.getByRole("button", { name: /Accept \(use this price\)/ }).click();
  await page.getByRole("button", { name: /^Send counter$/ }).click();

  await expect(page.getByText(/Counter sent to the buyer/)).toBeVisible();
});

test("a Starter merchant sees the locked upsell, not the suggest button", async ({
  page,
}) => {
  // Run with a Starter-plan session to exercise the gate.
  await page.goto(`${BASE_URL}/app/quotes/${QUOTE_ID}`);
  await expect(page.getByText(/AI counter-offers are a Growth feature/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^AI suggest$/ })).toHaveCount(0);
});
