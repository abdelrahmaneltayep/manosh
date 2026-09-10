import { describe, it, expect, vi, beforeEach } from "vitest";

// The storefront widget posts here cross-origin. These tests pin the two things
// App Store review 2.1.1 cares about: (1) CORS works, and (2) an internal failure
// NEVER reaches the shopper's browser as a 5xx / HTML error page.
vi.mock("../services/quote-widget.server", () => ({ createQuoteRequest: vi.fn() }));
vi.mock("../lib/sentry.server", () => ({ captureException: vi.fn() }));

import { action } from "./api.quote-request";
import { createQuoteRequest } from "../services/quote-widget.server";
import { captureException } from "../lib/sentry.server";

const post = (body: unknown) =>
  new Request("https://app.test/api/quote-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const run = (request: Request) => action({ request, params: {}, context: {} } as never);

describe("api.quote-request action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers the CORS preflight (OPTIONS) with 204 + headers", async () => {
    const res = await run(new Request("https://app.test/api/quote-request", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("never leaks a 5xx to the storefront when the service throws", async () => {
    (createQuoteRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db unreachable"));
    const res = await run(post({ shop: "s.myshopify.com", email: "a@b.co", lines: [], note: "hi" }));
    expect(res.status).toBe(200); // NOT 500 — a graceful, CORS-safe JSON error
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1); // root cause is logged, not swallowed
  });

  it("passes a successful submission through as { ok: true }", async () => {
    (createQuoteRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, requestId: "r1" });
    const res = await run(post({ shop: "s.myshopify.com", email: "a@b.co", lines: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("surfaces a known application error as JSON (not a crash), with CORS", async () => {
    (createQuoteRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "Enter a valid email address." });
    const res = await run(post({ shop: "s.myshopify.com", email: "nope", lines: [] }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await res.json()) as unknown).toEqual({ ok: false, error: "Enter a valid email address." });
  });

  it("rejects a submission with no shop, still with CORS headers", async () => {
    const res = await run(post({ email: "a@b.co" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });
});
