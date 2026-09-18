import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import prisma from "../db.server";
import {
  DEMO_EMAIL_DOMAIN,
  DemoRateLimiter,
  clientIp,
  demoBuyerEmail,
  demoCounterPrice,
  demoShopDomain,
  fetchDemoCompany,
  fetchDemoOrders,
  isDemoEmail,
  isDemoEnabled,
  startDemo,
  sweepDemoBuyers,
  type AdminGraphql,
} from "./demo.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const DOMAIN = "demo-shop.myshopify.com";

function stubAdmin(responses: Record<string, unknown>): AdminGraphql {
  return {
    graphql: async (query: string) => {
      const key = Object.keys(responses).find((k) => query.includes(k));
      return { json: async () => (key ? responses[key] : {}) };
    },
  };
}

const COMPANY_RESPONSE = {
  data: {
    companies: {
      nodes: [
        {
          id: "gid://shopify/Company/77",
          name: "Reef Trading",
          locations: { nodes: [{ id: "gid://shopify/CompanyLocation/701" }] },
          contacts: { nodes: [{ id: "gid://shopify/CompanyContact/7001" }] },
        },
      ],
    },
  },
};

const ORDERS_RESPONSE = {
  data: {
    orders: {
      nodes: [
        { id: "gid://shopify/Order/1032", name: "#1032", createdAt: "2026-08-01T10:00:00Z", totalPriceSet: { shopMoney: { amount: "1840.00", currencyCode: "USD" } } },
        { id: "gid://shopify/Order/1018", name: "#1018", createdAt: "2026-07-01T10:00:00Z", totalPriceSet: { shopMoney: { amount: "2210.40", currencyCode: "USD" } } },
      ],
    },
  },
};

describe("demo config + helpers (pure)", () => {
  const prev = process.env.MANNON_DEMO_SHOP;
  afterEach(() => {
    if (prev === undefined) delete process.env.MANNON_DEMO_SHOP;
    else process.env.MANNON_DEMO_SHOP = prev;
  });

  it("is off unless MANNON_DEMO_SHOP is set", () => {
    delete process.env.MANNON_DEMO_SHOP;
    expect(isDemoEnabled()).toBe(false);
    expect(demoShopDomain()).toBeNull();
    process.env.MANNON_DEMO_SHOP = "  Demo-Shop.myshopify.com ";
    expect(isDemoEnabled()).toBe(true);
    expect(demoShopDomain()).toBe("demo-shop.myshopify.com");
  });

  it("mints undeliverable, unique visitor addresses and recognises them", () => {
    const a = demoBuyerEmail(() => "abcd1234");
    expect(a).toBe(`visitor-abcd1234@${DEMO_EMAIL_DOMAIN}`);
    expect(isDemoEmail(a)).toBe(true);
    expect(isDemoEmail("buyer@acme-wholesale.example")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
    expect(demoBuyerEmail()).not.toBe(demoBuyerEmail());
  });

  it("counter price is a plain merchant-style unit price a few percent under list", () => {
    expect(demoCounterPrice("12.40")).toBe("11.90");
    expect(demoCounterPrice("4.20")).toBe("4.03");
    expect(demoCounterPrice("100")).toBe("96.00");
    expect(demoCounterPrice("0")).toBe("0"); // never negative or NaN
    expect(demoCounterPrice("abc")).toBe("abc");
  });

  it("prefers Fly-Client-IP, then the first X-Forwarded-For hop", () => {
    expect(clientIp(new Request("https://x/demo", { headers: { "fly-client-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("https://x/demo", { headers: { "x-forwarded-for": "5.6.7.8, 10.0.0.1" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("https://x/demo"))).toBe("unknown");
  });
});

describe("DemoRateLimiter (pure)", () => {
  it("caps sessions per ip per hour and lets the window slide", () => {
    const l = new DemoRateLimiter({ perIpPerHour: 2, perDay: 100 });
    const t0 = 1_000_000_000_000;
    expect(l.allow("a", t0)).toBe(true);
    expect(l.allow("a", t0 + 1)).toBe(true);
    expect(l.allow("a", t0 + 2)).toBe(false);
    expect(l.allow("b", t0 + 2)).toBe(true); // other ip unaffected
    expect(l.allow("a", t0 + 60 * 60 * 1000 + 5)).toBe(true); // hour elapsed
  });

  it("caps total sessions per day across ips", () => {
    const l = new DemoRateLimiter({ perIpPerHour: 10, perDay: 3 });
    const t0 = 1_000_000_000_000;
    expect(l.allow("a", t0)).toBe(true);
    expect(l.allow("b", t0)).toBe(true);
    expect(l.allow("c", t0)).toBe(true);
    expect(l.allow("d", t0)).toBe(false);
    expect(l.allow("d", t0 + 24 * 60 * 60 * 1000 + 1)).toBe(true);
  });
});

describe("Shopify reads (stubbed admin)", () => {
  it("maps the first company with its location + contact ids", async () => {
    const c = await fetchDemoCompany(stubAdmin({ MannonDemoCompany: COMPANY_RESPONSE }));
    expect(c).toEqual({
      id: "gid://shopify/Company/77",
      name: "Reef Trading",
      locationId: "gid://shopify/CompanyLocation/701",
      contactId: "gid://shopify/CompanyContact/7001",
    });
  });

  it("returns null when the store has no company (never fabricates one)", async () => {
    const c = await fetchDemoCompany(stubAdmin({ MannonDemoCompany: { data: { companies: { nodes: [] } } } }));
    expect(c).toBeNull();
  });

  it("maps recent orders and drops ones without a total", async () => {
    const bad = { data: { orders: { nodes: [...ORDERS_RESPONSE.data.orders.nodes, { id: "gid://shopify/Order/1", name: "#1", createdAt: "2026-01-01T00:00:00Z" }] } } };
    const orders = await fetchDemoOrders(stubAdmin({ MannonDemoOrders: bad }));
    expect(orders.map((o) => o.name)).toEqual(["#1032", "#1018"]);
    expect(orders[0]).toMatchObject({ amount: "1840.00", currencyCode: "USD" });
  });
});

describe("startDemo (no DB needed for the early exits)", () => {
  const prev = process.env.MANNON_DEMO_SHOP;
  afterEach(() => {
    if (prev === undefined) delete process.env.MANNON_DEMO_SHOP;
    else process.env.MANNON_DEMO_SHOP = prev;
  });

  it("reports disabled when no demo shop is configured", async () => {
    delete process.env.MANNON_DEMO_SHOP;
    expect(await startDemo({ ip: "1.1.1.1" })).toEqual({ ok: false, reason: "disabled" });
  });

  it("reports rate-limited before touching the database or Shopify", async () => {
    process.env.MANNON_DEMO_SHOP = DOMAIN;
    const limiter = new DemoRateLimiter({ perIpPerHour: 0, perDay: 0 });
    const adminFor = async () => {
      throw new Error("must not be called");
    };
    expect(await startDemo({ ip: "1.1.1.1", limiter, adminFor })).toEqual({ ok: false, reason: "rate-limited" });
  });
});

describe.skipIf(!hasDb)("startDemo (DB)", () => {
  const prev = process.env.MANNON_DEMO_SHOP;
  beforeEach(async () => {
    process.env.MANNON_DEMO_SHOP = DOMAIN;
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "ReorderSource","Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.MANNON_DEMO_SHOP;
    else process.env.MANNON_DEMO_SHOP = prev;
    await prisma.$disconnect();
  });

  const admin = stubAdmin({ MannonDemoCompany: COMPANY_RESPONSE, MannonDemoOrders: ORDERS_RESPONSE });
  const fresh = () => new DemoRateLimiter({ perIpPerHour: 100, perDay: 1000 });

  it("reports not-installed when the demo shop has no Shop row", async () => {
    const r = await startDemo({ ip: "1.1.1.1", limiter: fresh(), adminFor: async () => admin });
    expect(r).toEqual({ ok: false, reason: "not-installed" });
  });

  const CATALOG = [
    { variantId: "gid://shopify/ProductVariant/1", displayTitle: "Nitrile Gloves (M)", sku: "GLV-M", price: "12.40", currencyCode: "USD" },
    { variantId: "gid://shopify/ProductVariant/2", displayTitle: "Hand Sanitizer 500ml", sku: "SAN-500", price: "4.20", currencyCode: "USD" },
    { variantId: "gid://shopify/ProductVariant/3", displayTitle: "Face Masks (50)", sku: "MSK-50", price: "9.00", currencyCode: "USD" },
    { variantId: "gid://shopify/ProductVariant/4", displayTitle: "Thermometer", sku: "THM-1", price: "22.00", currencyCode: "USD" },
  ];

  it("seeds a countered quote to accept, a pending request, and a net-terms invoice", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: DOMAIN, defaultTermsDays: 30 } });
    const r = await startDemo({ ip: "1.1.1.1", limiter: fresh(), adminFor: async () => admin, catalogFor: async () => CATALOG });
    expect(r.ok).toBe(true);
    const buyerId = (r as { buyerId: string }).buyerId;
    const quotes = await prisma.quote.findMany({ where: { buyerId }, include: { lines: true, company: true }, orderBy: { createdAt: "asc" } });
    expect(quotes.map((q) => q.status).sort()).toEqual(["COUNTERED", "SUBMITTED"]);
    const countered = quotes.find((q) => q.status === "COUNTERED")!;
    expect(countered.lines).toHaveLength(3);
    // Real variant ids from the catalog, countered a little under list.
    expect(countered.lines[0].variantId).toBe("gid://shopify/ProductVariant/1");
    expect(countered.lines.map((l) => l.price.toString())).toEqual(["11.9", "4.03", "8.64"]);
    const invoices = await prisma.invoice.findMany({ where: { companyId: countered.companyId } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ orderId: "gid://shopify/Order/1032", status: "OPEN", currency: "USD" });
    expect(countered.company.shopId).toBe(shop.id);
  });

  it("does not seed quotes when the catalog is empty, and still opens the demo", async () => {
    await prisma.shop.create({ data: { shopifyDomain: DOMAIN } });
    const r = await startDemo({ ip: "1.1.1.1", limiter: fresh(), adminFor: async () => admin, catalogFor: async () => [] });
    expect(r.ok).toBe(true);
    expect(await prisma.quote.count()).toBe(0);
  });

  it("provisions the real company, reorder cards, and a fresh visitor buyer", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: DOMAIN } });
    const r = await startDemo({ ip: "1.1.1.1", limiter: fresh(), adminFor: async () => admin, catalogFor: async () => [], random: () => "deadbeef" });
    expect(r.ok).toBe(true);
    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: (r as { buyerId: string }).buyerId }, include: { company: true } });
    expect(buyer.email).toBe(`visitor-deadbeef@${DEMO_EMAIL_DOMAIN}`);
    expect(buyer.shopifyCompanyLocationId).toBe("gid://shopify/CompanyLocation/701");
    expect(buyer.shopifyContactId).toBe("gid://shopify/CompanyContact/7001");
    expect(buyer.company).toMatchObject({ shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/77", name: "Reef Trading" });
    const cards = await prisma.reorderSource.findMany({ where: { companyId: buyer.companyId }, orderBy: { orderedAt: "desc" } });
    expect(cards.map((c) => c.orderName)).toEqual(["#1032", "#1018"]);
  });

  it("gives each visit its own buyer under one company, and is idempotent for Shopify rows", async () => {
    await prisma.shop.create({ data: { shopifyDomain: DOMAIN } });
    const a = await startDemo({ ip: "1.1.1.1", limiter: fresh(), adminFor: async () => admin, catalogFor: async () => [] });
    const b = await startDemo({ ip: "2.2.2.2", limiter: fresh(), adminFor: async () => admin, catalogFor: async () => [] });
    expect(a.ok && b.ok && a.buyerId !== b.buyerId).toBe(true);
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.reorderSource.count()).toBe(2);
    expect(await prisma.buyer.count()).toBe(2);
  });

  it("reports no-company when the demo store has no B2B company", async () => {
    await prisma.shop.create({ data: { shopifyDomain: DOMAIN } });
    const empty = stubAdmin({ MannonDemoCompany: { data: { companies: { nodes: [] } } } });
    const r = await startDemo({ ip: "1.1.1.1", limiter: fresh(), adminFor: async () => empty });
    expect(r).toEqual({ ok: false, reason: "no-company" });
    expect(await prisma.company.count()).toBe(0);
  });

  it("sweeps visitor buyers older than a week but keeps real buyers", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: DOMAIN } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/77", name: "Reef Trading" } });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.buyer.create({ data: { companyId: company.id, email: `visitor-old@${DEMO_EMAIL_DOMAIN}`, createdAt: old } });
    await prisma.buyer.create({ data: { companyId: company.id, email: `visitor-new@${DEMO_EMAIL_DOMAIN}` } });
    await prisma.buyer.create({ data: { companyId: company.id, email: "real@reef.example", createdAt: old } });
    expect(await sweepDemoBuyers(company.id)).toBe(1);
    const left = (await prisma.buyer.findMany({ select: { email: true } })).map((b) => b.email).sort();
    expect(left).toEqual(["real@reef.example", `visitor-new@${DEMO_EMAIL_DOMAIN}`]);
  });
});
