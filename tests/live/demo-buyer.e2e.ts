import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

/*
 * The live buyer demo, driven by the agent against the deployed app
 * (e2e.live.config.ts). One serial group = one visitor buyer, so a run spends
 * one of the five demo starts allowed per IP per hour.
 *
 * Accepting the countered quote creates a real draft order on the demo store
 * (nothing is charged). The reorder outcome depends on live prices: within the
 * auto-approve tolerance it becomes a draft order, otherwise it lands in the
 * merchant's inbox; the assertion accepts either, as the testing instructions do.
 */
describe("live buyer demo", { tags: ["live", "demo", "agent"], serial: true }, () => {
  test("a visitor lands in the Mannon-branded demo portal", async ({ app, screen, browser }) => {
    await app.open("/demo");
    await screen.getByRole("link", "Open the buyer demo").tap();
    await expect(browser).toHaveURL(/\/portal/);
    await expect(screen.getByRole("heading", "Welcome, Demo buyer")).toBeVisible();
    await expect(screen.getByText("Demo portal.")).toBeVisible();
    await expect(screen.getByRole("heading", "Your quotes")).toBeVisible();
    await expect(screen.getByText("Countered")).toBeVisible();
  });

  test("the reorder card comes from a real order on the demo store", async ({ screen, agent }) => {
    await expect(screen.getByRole("heading", "Reorder a past order")).toBeVisible();
    const cards = screen.getByRole("link", "Reorder");
    expect(await cards.count()).toBeGreaterThan(0);
    await agent.assert("each reorder card shows an order number, a date and a currency amount");
  });

  test("accepting the countered quote creates an order", async ({ screen, agent }) => {
    await agent.act("open the quote marked Countered");
    await expect(screen.getByRole("heading", { level: 1 })).toContainText("Quote");
    await agent.act("accept the quote and create the order, confirming if asked");
    await expect(screen.getByText("Ordered")).toBeVisible();
    await agent.assert("the quote is marked Ordered and the totals and tax are shown as coming from Shopify");
  });

  test("one-tap reorder re-prices a past order through Shopify", async ({ app, screen, agent }) => {
    await app.open("/portal");
    await agent.act("click Reorder on the first card under Reorder a past order");
    await agent.assert(
      "the reorder went through: either the page shows a new quote marked Ordered, or it says the reorder is waiting for the merchant's approval",
    );
  });
});
