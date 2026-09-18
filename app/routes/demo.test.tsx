import { describe, it, expect, vi, beforeEach } from "vitest";

// The demo entry is public and linked from the landing page, so it must never
// surface a raw error: every outcome is a redirect into the portal or a
// plain-language notice.
vi.mock("../services/demo.server", () => ({
  startDemo: vi.fn(),
  clientIp: () => "1.2.3.4",
}));
vi.mock("../lib/sentry.server", () => ({ captureException: vi.fn() }));

import { loader } from "./demo";
import { startDemo } from "../services/demo.server";
import { captureException } from "../lib/sentry.server";

const run = () => loader({ request: new Request("https://app.test/demo"), params: {}, context: {} } as never);
const mocked = startDemo as ReturnType<typeof vi.fn>;

describe("demo route loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a buyer session and redirects into the portal", async () => {
    mocked.mockResolvedValue({ ok: true, buyerId: "b1" });
    const res = (await run()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/portal");
    expect(res.headers.get("Set-Cookie")).toContain("__mannon_portal=");
  });

  it.each(["disabled", "not-installed", "no-company", "rate-limited"] as const)(
    "renders a plain-language notice for %s",
    async (reason) => {
      mocked.mockResolvedValue({ ok: false, reason });
      const data = (await run()) as { notice: { title: string; body: string } };
      expect(data.notice.title).toBeTruthy();
      expect(data.notice.body).toBeTruthy();
    },
  );

  it("never throws when the service fails — logs and shows a notice", async () => {
    mocked.mockRejectedValue(new Error("shopify down"));
    const data = (await run()) as { notice: { title: string } };
    expect(data.notice.title).toMatch(/something went wrong/i);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
