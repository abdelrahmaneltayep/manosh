import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// /demo/store — the sample storefront product page with Mannon's blocks: the
// three-step quote request, the price gate, the way back to Mannon.
describe("demo store", { tags: ["smoke", "public", "demo", "a11y"] }, () => {
  test("Add to Quote opens the request and walks the three steps", async ({ app, screen }) => {
    await app.open("/demo/store");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Harbor Blend Espresso, 1 kg");
    await expect(screen.getByRole("link", "← Back to Mannon")).toHaveAttribute("href", "/");

    // The tab starts at one pre-filled line; adding the same product merges quantities.
    await expect(screen.getByRole("button", "Quote (1)")).toBeVisible();
    await screen.getByRole("button", "Add to Quote").first().tap();
    const dialog = screen.getByRole("dialog", "Request a quote");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", "Quote (2)")).toHaveCount(0);
    await expect(screen.getByRole("button", "Quote (1)")).toBeVisible();
    await expect(dialog.getByLabel("Quantity for Harbor Blend Espresso, 1 kg")).toHaveValue("24");

    await dialog.getByRole("button", "Next step").tap();
    await expect(dialog.getByLabel("Work email")).toHaveValue("noor@bluebirdcafes.example");
    await expect(dialog.getByLabel("Payment terms you’d like")).toBeVisible();

    await dialog.getByRole("button", "Next step").tap();
    await expect(dialog.getByText("Terms requested")).toBeVisible();
    await dialog.getByRole("button", "Send quote request").tap();
    await expect(dialog.getByRole("heading", "Quote request sent")).toBeVisible();
    await expect(dialog.getByRole("link", "See what happens next")).toHaveAttribute("href", /\/demo\/(buyer|tour)/);
    await expect(dialog.getByRole("link", "Back to Mannon")).toHaveAttribute("href", "/");
  });

  test("a second product adds a line and Escape closes the drawer", async ({ app, screen, browser }) => {
    await app.open("/demo/store");
    await screen.getByRole("button", "Add to Quote").nth(1).tap();
    const dialog = screen.getByRole("dialog", "Request a quote");
    await expect(dialog.getByText("Guji Natural, Ethiopia, 1 kg")).toBeVisible();
    await browser.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(screen.getByRole("button", "Quote (2)")).toBeVisible();
  });

  test("the price gate hides the price for guests", async ({ app, screen }) => {
    await app.open("/demo/store");
    await expect(screen.getByText("Bluebird Cafés price")).toBeVisible();
    await screen.getByRole("button", "guest (price gate on)").tap();
    await expect(screen.getByText("Log in for wholesale pricing · Request a quote")).toBeVisible();
    await expect(screen.getByText("Bluebird Cafés price")).toHaveCount(0);
    await screen.getByRole("button", "logged-in buyer").tap();
    await expect(screen.getByText("Bluebird Cafés price")).toBeVisible();
  });
});
