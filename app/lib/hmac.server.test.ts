import { describe, it, expect } from "vitest";
import { computeHmac, isValidHmac, verifyWebhook } from "./hmac.server";

const SECRET = "shpss_test_secret";
const BODY = JSON.stringify({ shop_domain: "s.myshopify.com" });

describe("HMAC verification", () => {
  it("computeHmac is deterministic base64 SHA-256", () => {
    expect(computeHmac(BODY, SECRET)).toBe(computeHmac(BODY, SECRET));
    expect(computeHmac(BODY, SECRET)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("accepts a valid signature", () => {
    expect(isValidHmac(BODY, computeHmac(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a tampered body, wrong secret, and missing header", () => {
    const good = computeHmac(BODY, SECRET);
    expect(isValidHmac(BODY + "x", good, SECRET)).toBe(false);
    expect(isValidHmac(BODY, computeHmac(BODY, "other"), SECRET)).toBe(false);
    expect(isValidHmac(BODY, null, SECRET)).toBe(false);
    expect(isValidHmac(BODY, "", SECRET)).toBe(false);
  });

  it("verifyWebhook returns the raw body and headers", async () => {
    const request = new Request("https://app.example.com/webhooks/shop/redact", {
      method: "POST",
      body: BODY,
      headers: {
        "X-Shopify-Hmac-Sha256": computeHmac(BODY, SECRET),
        "X-Shopify-Shop-Domain": "s.myshopify.com",
        "X-Shopify-Topic": "shop/redact",
      },
    });
    const result = await verifyWebhook(request, SECRET);
    expect(result.ok).toBe(true);
    expect(result.rawBody).toBe(BODY);
    expect(result.shopDomain).toBe("s.myshopify.com");
    expect(result.topic).toBe("shop/redact");
  });
});
