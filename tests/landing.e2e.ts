import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// The public landing page: brand, the one-liner, the native-B2B line, and the
// two ways into the demo. No login form unless ?login is present.
describe("landing page", { tags: ["smoke", "public"] }, () => {
  test("shows the pitch and the demo entry points", async ({ app, screen, browser }) => {
    await app.open("/");
    await expect(browser).toHaveTitle(/Mannon/);
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Wholesale quoting, without the email grind");
    await expect(screen.getByText("Built on Shopify’s native B2B — every price comes from Shopify.")).toBeVisible();
    await expect(screen.getByRole("link", "Try the demo")).toBeVisible();
    await expect(screen.getByRole("heading", { level: 2 }).filter({ hasText: "See the whole workflow" })).toBeVisible();
    await expect(screen.getByRole("link", "Start the tour")).toBeVisible();
    // The merchant login (shop domain → Shopify OAuth) sits beside the demo entry.
    await expect(screen.getByLabel("Shop domain")).toBeVisible();
    await expect(screen.getByRole("button", "Log in")).toBeVisible();
    await expect(screen.getByText("e.g. my-shop-domain.myshopify.com")).toBeVisible();
  });

  test("Try the demo leads to the demo hub", async ({ app, screen, browser }) => {
    await app.open("/");
    await screen.getByRole("link", "Try the demo").tap();
    await expect(browser).toHaveURL("/demo");
    await expect(screen.getByRole("heading", { level: 1 })).toContainText("No install, no sign-up.");
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
