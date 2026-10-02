import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// /demo — the hub with two cards. The buyer card is live only when the server
// has MANNON_DEMO_SHOP set; otherwise it shows an unavailable note, never a
// broken link.
describe("demo hub", { tags: ["smoke", "public", "demo"] }, () => {
  test("offers the buyer demo and the merchant tour", async ({ app, screen }) => {
    await app.open("/demo");
    await expect(screen.getByRole("heading", { level: 1 })).toContainText("See the whole workflow.");
    await expect(screen.getByRole("heading", "Open the buyer portal")).toBeVisible();
    await expect(screen.getByRole("heading", "Walk through the merchant admin")).toBeVisible();
    await expect(screen.getByText("Built on Shopify’s native B2B — every price comes from Shopify.")).toBeVisible();

    const live = await screen.getByRole("link", "Open the buyer demo").isVisible();
    if (live) {
      await expect(screen.getByRole("link", "Open the buyer demo")).toHaveAttribute("href", "/demo/buyer");
    } else {
      await expect(screen.getByText("Buyer demo unavailable")).toBeVisible();
    }
    await expect(screen.getByText("Sample buyer · nothing is charged")).toBeVisible();
  });

  test("Start the tour opens the merchant tour", async ({ app, screen, browser }) => {
    await app.open("/demo");
    await screen.getByRole("link", "Start the tour").tap();
    await expect(browser).toHaveURL("/demo/tour");
    await expect(screen.getByText(/^Step 1 of \d+$/)).toBeVisible();
  });

  test("the buyer demo fails closed when the demo store is not configured", async ({ app, screen, browser }) => {
    await app.open("/demo/buyer");
    const live = (await browser.url()).includes("/portal");
    if (live) {
      // MANNON_DEMO_SHOP is set: the route provisions a visitor and lands in the portal.
      await expect(screen.getByRole("heading", "Welcome, Demo buyer")).toBeVisible();
      return;
    }
    // No demo store: a plain-language notice with a way forward, never an error page.
    const notice = screen.getByRole("status");
    await expect(notice.getByRole("heading", { level: 1 })).toHaveText("The buyer demo isn’t available right now");
    await expect(notice.getByRole("link", "Take the merchant tour")).toHaveAttribute("href", "/demo/tour");
    await expect(notice.getByRole("link", "Back to the demo")).toHaveAttribute("href", "/demo");
  });
});
