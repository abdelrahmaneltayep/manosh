import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// Buyer sign-in pages. Mannon has no email sender connected, so these pages
// must not tell a buyer to look for an email from Mannon: the supplier hands
// over the sign-in link themselves.
describe("buyer sign-in", { tags: ["smoke", "public"] }, () => {
  test("the sign-in page asks for the supplier's link and promises no email", async ({ app, screen }) => {
    await app.open("/portal/signin");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Open your sign-in link");
    await expect(screen.getByText(/ask your supplier for a new one/i)).toBeVisible();
    await expect(screen.getByText(/check your email/i)).toHaveCount(0);
    // Passwordless by design: no form to fill in.
    await expect(screen.getByRole("textbox")).toHaveCount(0);
  });

  test("a bad sign-in link is refused, with or without a destination", async ({ app, screen }) => {
    await app.open("/portal/auth?token=not-a-real-token&next=/portal/quotes/abc");
    await expect(screen.getByRole("heading", "This link can’t be used")).toBeVisible();
    await expect(screen.getByText(/ask your supplier for a new link/i)).toBeVisible();
    await expect(screen.getByRole("button", "Continue")).toHaveCount(0);
  });

  test("a destination outside the portal never becomes a redirect", async ({ app }) => {
    const form = new URLSearchParams({ token: "not-a-real-token", next: "https://evil.example/" });
    const res = await fetch(new URL("/portal/auth", app.baseUrl), { method: "POST", body: form, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").not.toContain("evil.example");
  });
});

// The sales-rep portal's sign-in page: reps get their link from the store, not
// from an email Mannon sends.
describe("rep sign-in", { tags: ["smoke", "public"] }, () => {
  test("asks for the invite link and promises no email", async ({ app, screen }) => {
    await app.open("/rep/signin");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Sales-rep sign-in");
    await expect(screen.getByText(/invite email/i)).toHaveCount(0);
  });
});
