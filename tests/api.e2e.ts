import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// Public HTTP surface: health, the storefront quote-request endpoint's CORS
// contract, and the customer-account quotes endpoint failing closed.
describe("public API", { tags: ["smoke", "api"] }, () => {
  test("/healthz answers with a value-free config signal", async ({ app }) => {
    const res = await fetch(new URL("/healthz", app.baseUrl));
    expect([200, 503]).toContain(res.status);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { status: string; configOk: boolean };
    expect(body).toMatchObject({ status: expect.stringMatching(/^(ok|degraded)$/), configOk: expect.any(Boolean) });
    expect(body.configOk).toBe(res.status === 200);
    // No secret values and no variable names leak in the public body.
    expect(JSON.stringify(body)).not.toMatch(/SHOPIFY_|DATABASE_URL|ANTHROPIC/);
  });

  test("/api/quote-request answers the storefront preflight and rejects a bad body", async ({ app }) => {
    const url = new URL("/api/quote-request", app.baseUrl);
    const preflight = await fetch(url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("access-control-allow-origin")).toBe("*");
    expect(await bad.json()).toMatchObject({ ok: false, error: expect.any(String) });

    const wrongMethod = await fetch(url, { method: "GET" });
    expect([405, 400]).toContain(wrongMethod.status);
  });

  test("/api/account/quotes fails closed without a customer session token", async ({ app }) => {
    const res = await fetch(new URL("/api/account/quotes", app.baseUrl));
    // shopify-app-remix answers a missing/invalid customer-account token with
    // 401 or 410; a 200 is only acceptable when the body is the disabled shape.
    expect([401, 410, 200]).toContain(res.status);
    if (res.status === 200) {
      expect(await res.json()).toMatchObject({ enabled: false, quotes: [] });
    }
  });
});
