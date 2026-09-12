import { describe, it, expect, vi, beforeEach } from "vitest";

// Storefront Make-an-Offer widget posts here cross-origin. Same contract as the
// Request-a-Quote endpoint: CORS works, and an internal failure NEVER reaches the
// shopper as a 5xx / HTML error page.
vi.mock("../services/offers.server", () => ({ submitPublicOffer: vi.fn() }));
vi.mock("../lib/sentry.server", () => ({ captureException: vi.fn() }));

import { action } from "./api.offer";
import { submitPublicOffer } from "../services/offers.server";
import { captureException } from "../lib/sentry.server";

const post = (body: unknown) =>
  new Request("https://app.test/api/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const run = (request: Request) => action({ request, params: {}, context: {} } as never);

describe("api.offer action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers the CORS preflight (OPTIONS) with 204", async () => {
    const res = await run(new Request("https://app.test/api/offer", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("never leaks a 5xx to the storefront when the service throws", async () => {
    (submitPublicOffer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db unreachable"));
    const res = await run(post({ shop: "s.myshopify.com", email: "a@b.co", lines: [], offeredTotal: 10 }));
    expect(res.status).toBe(200); // NOT 500
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("passes a successful offer through", async () => {
    (submitPublicOffer as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, outcome: "pending", counterTotal: null });
    const res = await run(post({ shop: "s.myshopify.com", email: "a@b.co", lines: [], offeredTotal: 10 }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ ok: true, outcome: "pending" });
  });

  it("rejects a submission with no shop, with CORS", async () => {
    const res = await run(post({ email: "a@b.co" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(submitPublicOffer).not.toHaveBeenCalled();
  });
});
