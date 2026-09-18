import { describe, it, expect, vi, beforeEach } from "vitest";

// The live buyer entry is public and linked from the landing page, so it must
// never surface a raw error: every outcome is a redirect into the portal or a
// plain-language notice.
vi.mock("../services/demo.server", () => ({
  startDemo: vi.fn(),
  clientIp: () => "1.2.3.4",
  isDemoEnabled: () => true,
}));
vi.mock("../lib/sentry.server", () => ({ captureException: vi.fn() }));

import { loader } from "./demo.buyer";
import { loader as hubLoader } from "./demo._index";
import { startDemo } from "../services/demo.server";
import { captureException } from "../lib/sentry.server";
import { TOUR_SCENES } from "../demo-tour/scenes";

const run = () => loader({ request: new Request("https://app.test/demo/buyer"), params: {}, context: {} } as never);
const mocked = startDemo as ReturnType<typeof vi.fn>;

describe("demo.buyer loader", () => {
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

describe("demo hub + tour data", () => {
  it("hub reports whether the live buyer demo is on", async () => {
    expect(await hubLoader()).toEqual({ buyerLive: true });
  });

  it("tour scenes are unique, titled, and carry sample-screen markup", () => {
    const ids = TOUR_SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const s of TOUR_SCENES) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.blurb.length).toBeGreaterThan(20);
      expect(s.html).toMatch(/<div/);
      expect(s.html).not.toMatch(/<script/i);
    }
    // The tour must show the core loop and the AI guardrail.
    expect(ids).toEqual(expect.arrayContaining(["board", "newq", "claude", "accept", "reorder", "orderpad"]));
    expect(TOUR_SCENES.find((s) => s.id === "claude")!.html).toMatch(/never acts on its own/);
  });
});
