import { describe, it, expect, vi, beforeEach } from "vitest";

// F25.5 — the Customer Account UI extension ("Mannon — Your quotes") calls this
// endpoint with the customer-account session token. Contract under test:
//   • identity comes ONLY from the verified token (sub + dest), never the query;
//   • any paid plan (Starter / Growth / Scale) is enabled, trial/free/cancelled
//     fail closed with `enabled: false` and an empty list;
//   • an internal failure never reaches the account page as a 5xx.
const customerAccount = vi.fn();
vi.mock("../shopify.server", () => ({
  authenticate: { public: { customerAccount: (req: Request) => customerAccount(req) } },
}));
vi.mock("../db.server", () => ({ default: { shop: { findUnique: vi.fn() } } }));
vi.mock("../services/account-quotes.server", () => ({
  resolveCustomerEmail: vi.fn(),
  listQuotesForBuyer: vi.fn(),
}));
vi.mock("../lib/quote-ops", () => ({ QUOTE_OPS_ENABLED: () => true }));
vi.mock("../lib/sentry.server", () => ({ captureException: vi.fn() }));

import { loader } from "./api.account.quotes";
import prisma from "../db.server";
import { resolveCustomerEmail, listQuotesForBuyer } from "../services/account-quotes.server";
import { captureException } from "../lib/sentry.server";

const findUnique = prisma.shop.findUnique as unknown as ReturnType<typeof vi.fn>;
const resolveEmail = resolveCustomerEmail as unknown as ReturnType<typeof vi.fn>;
const listQuotes = listQuotesForBuyer as unknown as ReturnType<typeof vi.fn>;

const cors = (res: Response) => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
};

function tokenFor(sub: string, dest = "https://s.myshopify.com") {
  customerAccount.mockResolvedValue({ sessionToken: { sub, dest }, cors });
}

const run = (url = "https://app.test/api/account/quotes") =>
  loader({ request: new Request(url), params: {}, context: {} } as never);

describe("api.account.quotes loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenFor("gid://shopify/Customer/1");
    resolveEmail.mockResolvedValue("buyer@acme.test");
    listQuotes.mockResolvedValue([{ id: "q1", status: "COUNTERED" }]);
  });

  it.each(["STARTER", "GROWTH", "SCALE"])("is enabled on the %s plan", async (plan) => {
    findUnique.mockResolvedValue({ plan });
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as { enabled: boolean; quotes: unknown[]; portalBase: string };
    expect(body.enabled).toBe(true);
    expect(body.quotes).toHaveLength(1);
    expect(body.portalBase).toMatch(/\/portal$/);
    // Shop is looked up from the token's `dest`, email from the token's `sub`.
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { shopifyDomain: "s.myshopify.com" } }));
    expect(resolveEmail).toHaveBeenCalledWith("s.myshopify.com", "gid://shopify/Customer/1");
    expect(listQuotes).toHaveBeenCalledWith("s.myshopify.com", "buyer@acme.test");
  });

  it.each(["TRIAL", "FREE", "CANCELLED"])("fails closed on the %s plan", async (plan) => {
    findUnique.mockResolvedValue({ plan });
    const body = (await (await run()).json()) as { enabled: boolean; quotes: unknown[] };
    expect(body).toMatchObject({ enabled: false, quotes: [] });
    expect(resolveEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the shop is not installed", async () => {
    findUnique.mockResolvedValue(null);
    const body = (await (await run()).json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
    expect(listQuotes).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied email — identity comes from the token only", async () => {
    findUnique.mockResolvedValue({ plan: "GROWTH" });
    await run("https://app.test/api/account/quotes?email=victim@other.test");
    expect(listQuotes).toHaveBeenCalledWith("s.myshopify.com", "buyer@acme.test");
    expect(listQuotes).not.toHaveBeenCalledWith(expect.anything(), "victim@other.test");
  });

  it("fails closed when the token's customer has no resolvable email", async () => {
    findUnique.mockResolvedValue({ plan: "GROWTH" });
    resolveEmail.mockResolvedValue(null);
    const body = (await (await run()).json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
    expect(listQuotes).not.toHaveBeenCalled();
  });

  it("never leaks a 5xx to the account page when the DB throws", async () => {
    findUnique.mockRejectedValue(new Error("db unreachable"));
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(((await res.json()) as { enabled: boolean }).enabled).toBe(false);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
