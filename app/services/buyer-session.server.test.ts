import { describe, it, expect } from "vitest";
import {
  commitBuyerSession,
  destroyBuyerSession,
  getBuyerId,
  requireBuyerId,
} from "./buyer-session.server";

function requestWithCookie(setCookie: string): Request {
  // Turn a Set-Cookie header into a Cookie request header (name=value).
  const cookiePair = setCookie.split(";")[0];
  return new Request("https://app.example.com/portal", {
    headers: { Cookie: cookiePair },
  });
}

describe("buyer session cookie", () => {
  it("round-trips a buyer id through a signed cookie", async () => {
    const setCookie = await commitBuyerSession("buyer_123");
    const buyerId = await getBuyerId(requestWithCookie(setCookie));
    expect(buyerId).toBe("buyer_123");
  });

  it("returns null when there is no cookie", async () => {
    const request = new Request("https://app.example.com/portal");
    expect(await getBuyerId(request)).toBeNull();
  });

  it("sets an HttpOnly cookie scoped to /portal", async () => {
    const setCookie = await commitBuyerSession("buyer_123");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/portal/i);
  });

  it("requireBuyerId throws a redirect when unauthenticated", async () => {
    const request = new Request("https://app.example.com/portal");
    try {
      await requireBuyerId(request);
      throw new Error("expected a redirect to be thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      const response = thrown as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/portal/signin");
    }
  });

  it("requireBuyerId returns the id when authenticated", async () => {
    const setCookie = await commitBuyerSession("buyer_xyz");
    const id = await requireBuyerId(requestWithCookie(setCookie));
    expect(id).toBe("buyer_xyz");
  });

  it("destroy produces an expiring cookie", async () => {
    const request = new Request("https://app.example.com/portal");
    const setCookie = await destroyBuyerSession(request);
    // Max-Age=0 (or an epoch Expires) clears the cookie.
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});
