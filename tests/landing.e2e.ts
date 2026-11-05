import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// The public home page: the guided journey, the demo store section, the
// features block, the merchant login, and the ?shop= hand-off.
describe("home page", { tags: ["smoke", "public"] }, () => {
  test("shows the journey, the demo store and the login", async ({ app, screen, browser }) => {
    await app.open("/");
    await expect(browser).toHaveTitle(/Mannon/);
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("From a buyer’s first click to a Shopify draft order");
    // Nav: demo store, journey, features, pricing — and no list of design options.
    const nav = screen.getByRole("navigation", "Main");
    await expect(nav.getByRole("link", "Demo store")).toHaveAttribute("href", "/demo/store");
    await expect(nav.getByRole("link", "Pricing")).toHaveAttribute("href", "/pricing");
    await expect(nav.getByRole("link", /All options/)).toHaveCount(0);
    // The eight steps and their progress bar.
    const progress = screen.getByRole("navigation", "Journey steps");
    await expect(progress.getByRole("link")).toHaveCount(8);
    await expect(screen.getByRole("heading", "A buyer asks for a quote")).toBeVisible();
    await expect(screen.getByRole("heading", "Weeks later: one-tap reorder")).toBeVisible();
    // Demo store section and features block.
    await expect(screen.getByRole("heading", "Shop it like a wholesale buyer")).toBeVisible();
    await expect(screen.getByRole("heading", "Everything you need to quote, from storefront to draft order")).toBeVisible();
    await expect(screen.getByText("Built on Shopify’s native B2B — every price comes from Shopify.")).toBeVisible();
    // Merchants open Mannon from the Shopify admin or install from the App Store;
    // nobody is asked to type a shop domain (App Store requirement 2.3.1).
    await expect(screen.getByRole("link", "Install from the Shopify App Store")).toHaveAttribute("href", "https://apps.shopify.com/mannon");
    await expect(screen.getByLabel("Shop domain")).toHaveCount(0);
    await expect(screen.getByRole("textbox")).toHaveCount(0);
  });

  test("/auth/login explains how to open Mannon and asks for no shop domain", async ({ app, screen }) => {
    await app.open("/auth/login");
    await expect(screen.getByRole("heading", "Open Mannon from Shopify")).toBeVisible();
    await expect(screen.getByRole("textbox")).toHaveCount(0);
    await expect(screen.getByRole("link", "Install from the Shopify App Store")).toBeVisible();
  });

  test("Open the demo store leads to the demo store page", async ({ app, screen, browser }) => {
    await app.open("/");
    await screen.getByRole("link", "Open the demo store").first().tap();
    await expect(browser).toHaveURL("/demo/store");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Harbor Blend Espresso, 1 kg");
  });

  test("Pricing in the nav opens the pricing page at the top", async ({ app, screen, browser }) => {
    await app.open("/");
    await screen.getByRole("navigation", "Main").getByRole("link", "Pricing").tap();
    await expect(browser).toHaveURL("/pricing");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Plans that grow with your wholesale");
  });

  test("a shop parameter hands off to the embedded app", async ({ app, browser }) => {
    // /?shop=… is how Shopify opens the app; it must redirect into /app, never render the landing.
    await app.open("/?shop=example.myshopify.com");
    await expect(browser).toHaveURL(/\/app\?shop=example\.myshopify\.com|\/auth\/login/);
  });

  test("the privacy policy is served", async ({ app, screen }) => {
    await app.open("/privacy");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
    await expect(screen.getByText(/^Last updated /)).toBeVisible();
  });
});
