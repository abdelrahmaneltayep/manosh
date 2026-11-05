import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// /pricing — the public v3 ladder: four plans, the annual toggle, the
// comparison table and the FAQ. Numbers come from app/lib/billing-v3.ts.
describe("pricing page", { tags: ["smoke", "public"] }, () => {
  test("shows the four plans with monthly prices and switches to annual", async ({ app, screen, browser }) => {
    await app.open("/pricing");
    await expect(browser).toHaveTitle(/Pricing/);
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Plans that grow with your wholesale");
    for (const name of ["Free", "Starter", "Growth", "Scale"]) {
      await expect(screen.getByRole("article", name)).toBeVisible();
    }
    const growth = screen.getByRole("article", "Growth");
    await expect(growth.getByText("Recommended")).toBeVisible();
    await expect(growth.getByText("$29")).toBeVisible();
    await expect(growth.getByText("14-day free trial")).toBeVisible();

    const toggle = screen.getByRole("switch", "Bill annually");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(growth.getByText("$24.17")).toBeVisible();
    await expect(growth.getByText("$290 billed yearly · 14-day free trial")).toBeVisible();
    await expect(screen.getByRole("article", "Free").getByText("Free forever")).toBeVisible();
  });

  test("compares plans and answers the per-order fee question", async ({ app, screen }) => {
    await app.open("/pricing");
    const table = screen.getByRole("table");
    await expect(table.getByRole("columnheader", "Scale")).toBeVisible();
    await expect(table.getByRole("row", /Company accounts/)).toContainText("Unlimited");
    await expect(table.getByRole("row", /Draft with Claude counter-offers/)).toBeVisible();
    await expect(screen.getByText(/No per-order fees, ever — one flat monthly price\./)).toBeVisible();
    await screen.getByText("Is there a per-order fee?").tap();
    await expect(screen.getByText(/Mannon is one flat monthly price/)).toBeVisible();
    await expect(screen.getByRole("link", "Try the demo store")).toHaveAttribute("href", "/demo/store");
  });
});
