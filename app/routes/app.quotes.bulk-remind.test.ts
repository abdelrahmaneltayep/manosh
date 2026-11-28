import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bulk "Send reminder" on the Waiting on buyer view.
const sendNow = vi.fn();
vi.mock("../shopify.server", () => ({ authenticate: { admin: async () => ({ session: { shop: "bulk.myshopify.com" } }) } }));
vi.mock("../services/followups.server", () => ({ sendNow: (...a: unknown[]) => sendNow(...a) }));
vi.mock("../services/mailer.server", () => ({ emailDeliveryEnabled: () => process.env.TEST_EMAIL_ON === "1" }));

const { action } = await import("./app.quotes._index");

function post(ids: string[], intent = "remind") {
  const body = new FormData();
  body.set("intent", intent);
  for (const id of ids) body.append("quoteId", id);
  return action({ request: new Request("https://app.example.com/app/quotes?view=waiting", { method: "POST", body }), params: {}, context: {} });
}

describe("bulk reminders", () => {
  beforeEach(() => {
    sendNow.mockReset();
    vi.stubEnv("MANNON_FF_FOLLOWUPS", "true");
    vi.stubEnv("TEST_EMAIL_ON", "1");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends one reminder per selected quote, once each, for this shop", async () => {
    sendNow.mockResolvedValue(true);
    expect(await post(["q1", "q2", "q1"])).toEqual({ ok: true, message: "Reminder sent to 2 buyers." });
    expect(sendNow.mock.calls).toEqual([
      ["bulk.myshopify.com", "q1", "https://app.example.com"],
      ["bulk.myshopify.com", "q2", "https://app.example.com"],
    ]);
  });

  it("says plainly how many couldn't be sent", async () => {
    sendNow.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("down"));
    const result = await post(["a", "b", "c"]);
    expect(result).toMatchObject({ ok: true });
    expect("message" in result && result.message).toMatch(/^Reminder sent to 1 buyer\. 2 couldn’t be sent/);
  });

  it("refuses when no email sender is connected, and sends nothing", async () => {
    vi.stubEnv("TEST_EMAIL_ON", "0");
    expect(await post(["a"])).toMatchObject({ ok: false, error: expect.stringMatching(/no email sender is connected/) });
    expect(sendNow).not.toHaveBeenCalled();
  });

  it("caps one click at 50 quotes", async () => {
    sendNow.mockResolvedValue(true);
    await post(Array.from({ length: 80 }, (_, i) => `q${i}`));
    expect(sendNow).toHaveBeenCalledTimes(50);
  });
});
