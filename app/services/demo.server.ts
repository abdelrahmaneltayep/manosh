import prisma from "../db.server";

/**
 * Public "Try the demo" (landing page). Lets a visitor open the buyer portal on
 * the merchant-designated demo store without installing anything or receiving
 * a magic link.
 *
 * How it stays honest with the guardrails:
 * - No fabricated ids. The demo company is a REAL company on the demo store,
 *   read from the Admin API (id, location, contact), so accepting a demo quote
 *   creates a real draft order there via `draftOrderCalculate`/`draftOrderCreate`
 *   exactly like a real buyer would.
 * - Reorder cards come from the demo store's real past orders.
 * - Every visitor gets their own throwaway buyer (an address on a reserved,
 *   undeliverable domain — no PII), so visitors never see each other's quotes.
 * - Bounded: per-IP and daily caps, and demo buyers older than a week are
 *   swept on entry. Off entirely unless MANNON_DEMO_SHOP is set.
 *
 * `shopify.server` is imported lazily so this module stays import-safe in unit
 * tests (importing it at top level runs shopifyApp(), which needs env vars).
 */

/** RFC 2606 reserves `.invalid`, so demo addresses can never receive mail. */
export const DEMO_EMAIL_DOMAIN = "demo.mannon.invalid";
export const DEMO_BUYER_NAME = "Demo buyer";
const DEMO_BUYER_TTL_DAYS = 7;

/** The demo store's myshopify domain, or null when the demo is switched off. */
export function demoShopDomain(): string | null {
  const v = process.env.MANNON_DEMO_SHOP?.trim().toLowerCase();
  return v ? v : null;
}

export function isDemoEnabled(): boolean {
  return demoShopDomain() !== null;
}

/** True for buyers created by the demo (used for the portal banner + sweep). */
export function isDemoEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/** A unique, non-deliverable address per visit. Pure, injectable for tests. */
export function demoBuyerEmail(random: () => string = defaultRandom): string {
  return `visitor-${random()}@${DEMO_EMAIL_DOMAIN}`;
}

function defaultRandom(): string {
  // 8 hex chars is plenty for uniqueness; collisions just fall into the upsert.
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

/* ---------------------------------------------------------------- rate limit */

export interface DemoLimits {
  perIpPerHour: number;
  perDay: number;
}

export const DEFAULT_DEMO_LIMITS: DemoLimits = { perIpPerHour: 5, perDay: 500 };

/**
 * Tiny in-memory limiter (per process). Good enough for a landing-page demo:
 * it bounds row growth and stops a crawler from minting sessions in a loop.
 * Pure over `now` so it is unit-testable.
 */
export class DemoRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly day: number[] = [];
  constructor(private readonly limits: DemoLimits = DEFAULT_DEMO_LIMITS) {}

  /** Returns true and records the hit when allowed; false when over a cap. */
  allow(ip: string, now: number = Date.now()): boolean {
    const hour = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const mine = (this.hits.get(ip) ?? []).filter((t) => t > hour);
    while (this.day.length && this.day[0] <= dayAgo) this.day.shift();
    if (mine.length >= this.limits.perIpPerHour) return false;
    if (this.day.length >= this.limits.perDay) return false;
    mine.push(now);
    this.hits.set(ip, mine);
    this.day.push(now);
    // Keep the map from growing without bound.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (!v.some((t) => t > hour)) this.hits.delete(k);
    }
    return true;
  }
}

export const demoLimiter = new DemoRateLimiter();

/** Best-effort client ip for the limiter (Fly sets Fly-Client-IP; else XFF). */
export function clientIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/* ------------------------------------------------------------- Shopify reads */

export interface DemoCompanyRef {
  id: string;
  name: string;
  locationId: string | null;
  contactId: string | null;
}

export interface DemoOrderRef {
  id: string;
  name: string;
  createdAt: string;
  amount: string;
  currencyCode: string;
}

/** Minimal Admin client shape, so the service is testable with a stub. */
export interface AdminGraphql {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<{ json: () => Promise<unknown> }>;
}

/** The demo store's first company (real ids — never fabricated). */
export async function fetchDemoCompany(admin: AdminGraphql): Promise<DemoCompanyRef | null> {
  const res = await admin.graphql(
    `#graphql
    query MannonDemoCompany {
      companies(first: 1, sortKey: CREATED_AT) {
        nodes {
          id
          name
          locations(first: 1) { nodes { id } }
          contacts(first: 1) { nodes { id } }
        }
      }
    }`,
  );
  const body = (await res.json()) as {
    data?: {
      companies?: {
        nodes?: Array<{
          id: string;
          name: string;
          locations?: { nodes?: Array<{ id: string }> };
          contacts?: { nodes?: Array<{ id: string }> };
        }>;
      };
    };
  };
  const c = body?.data?.companies?.nodes?.[0];
  if (!c?.id) return null;
  return {
    id: c.id,
    name: c.name,
    locationId: c.locations?.nodes?.[0]?.id ?? null,
    contactId: c.contacts?.nodes?.[0]?.id ?? null,
  };
}

/** The demo store's most recent orders, for real reorder cards. */
export async function fetchDemoOrders(admin: AdminGraphql, first = 3): Promise<DemoOrderRef[]> {
  const res = await admin.graphql(
    `#graphql
    query MannonDemoOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes { id name createdAt totalPriceSet { shopMoney { amount currencyCode } } }
      }
    }`,
    { variables: { first } },
  );
  const body = (await res.json()) as {
    data?: {
      orders?: {
        nodes?: Array<{
          id: string;
          name: string;
          createdAt: string;
          totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
        }>;
      };
    };
  };
  return (body?.data?.orders?.nodes ?? [])
    .filter((o) => o?.id && o.totalPriceSet?.shopMoney?.amount && o.totalPriceSet.shopMoney.currencyCode)
    .map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      amount: o.totalPriceSet!.shopMoney!.amount!,
      currencyCode: o.totalPriceSet!.shopMoney!.currencyCode!,
    }));
}

/* ------------------------------------------------------------------- entry */

export type StartDemoResult =
  | { ok: true; buyerId: string }
  | { ok: false; reason: "disabled" | "not-installed" | "no-company" | "rate-limited" };

/** Minimal catalog item shape the seeder needs (matches catalog.server's CatalogItem). */
export interface DemoCatalogItem {
  variantId: string;
  displayTitle: string;
  sku: string | null;
  price: string;
  currencyCode: string;
}

/**
 * A merchant-style counter price: the list price less a small discount, as a
 * money string. This is a *proposed unit price* the merchant would type — not
 * a total, tax, or anything Shopify computes (guardrail #1 still holds: the
 * quote's totals come from draftOrderCalculate when the buyer accepts).
 */
export function demoCounterPrice(listPrice: string, discountPct = 4): string {
  const n = Number(listPrice);
  if (!Number.isFinite(n) || n <= 0) return listPrice;
  return (Math.round(n * (100 - discountPct)) / 100).toFixed(2);
}

/**
 * Seed the visitor's portal so every buyer feature has something to show:
 * one COUNTERED quote (the merchant has replied — the buyer can accept it and
 * get a real Shopify draft order), one SUBMITTED quote (awaiting the supplier),
 * and, for the company, one open net-terms invoice on the most recent real
 * order. Lines use real variants from the store's catalog — never fabricated.
 * Best-effort throughout: a seeding hiccup must never block the demo.
 */
export async function seedDemoBuyerData(input: {
  shopId: string;
  companyId: string;
  buyerId: string;
  catalog: DemoCatalogItem[];
  orders: DemoOrderRef[];
  termsDays: number;
  now?: Date;
}): Promise<{ quotes: number; invoices: number }> {
  const now = input.now ?? new Date();
  const items = input.catalog.filter((c) => Number(c.price) > 0).slice(0, 5);
  let quotes = 0;
  let invoices = 0;

  if (items.length > 0) {
    const { submitQuote, counterQuote } = await import("./quote.server");
    const line = (c: DemoCatalogItem, quantity: number) => ({
      variantId: c.variantId,
      sku: c.sku,
      title: c.displayTitle,
      quantity,
      price: c.price,
    });

    // 1) A countered quote the visitor can accept right away.
    const first = items.slice(0, 3);
    const countered = await submitQuote({
      companyId: input.companyId,
      buyerId: input.buyerId,
      lines: first.map((c, idx) => line(c, [24, 12, 6][idx] ?? 6)),
      poReference: "PO-DEMO-1042",
      now,
    });
    await counterQuote(countered.id, {
      lines: countered.lines.map((l) => ({ id: l.id, price: demoCounterPrice(l.price.toString()) })),
      now,
    });
    quotes += 1;

    // 2) A fresh request still with the supplier.
    const rest = items.slice(3, 5).length ? items.slice(3, 5) : items.slice(0, 2);
    await submitQuote({
      companyId: input.companyId,
      buyerId: input.buyerId,
      lines: rest.map((c) => line(c, 10)),
      now,
    });
    quotes += 1;
  }

  // 3) One open net-terms invoice for the company's latest real order
  //    (idempotent by orderId, so repeat visitors share it).
  const latest = input.orders[0];
  if (latest) {
    const { createInvoiceForOrder } = await import("./invoice.server");
    await createInvoiceForOrder({
      companyId: input.companyId,
      shopId: input.shopId,
      orderId: latest.id,
      amount: latest.amount,
      currency: latest.currencyCode,
      termsDays: input.termsDays,
      now,
    });
    invoices += 1;
  }

  return { quotes, invoices };
}

/**
 * Provision (idempotently) the demo company + a fresh visitor buyer on the demo
 * store and return the buyer id to start a portal session for. Never throws for
 * the expected failure modes — the route renders a plain-language page for each.
 */
export async function startDemo(options: {
  ip: string;
  limiter?: DemoRateLimiter;
  now?: Date;
  /** Injectable for tests; defaults to the shop's offline Admin session. */
  adminFor?: (shopDomain: string) => Promise<AdminGraphql>;
  /** Injectable for tests; defaults to the cached live catalog read. */
  catalogFor?: (shopDomain: string) => Promise<DemoCatalogItem[]>;
  random?: () => string;
}): Promise<StartDemoResult> {
  const domain = demoShopDomain();
  if (!domain) return { ok: false, reason: "disabled" };

  const limiter = options.limiter ?? demoLimiter;
  const now = options.now ?? new Date();
  if (!limiter.allow(options.ip, now.getTime())) return { ok: false, reason: "rate-limited" };

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: domain },
    select: { id: true, defaultTermsDays: true },
  });
  if (!shop) return { ok: false, reason: "not-installed" };

  const adminFor = options.adminFor ?? defaultAdminFor;
  const admin = await adminFor(domain);
  const company = await fetchDemoCompany(admin);
  if (!company) return { ok: false, reason: "no-company" };

  const companyRow = await prisma.company.upsert({
    where: { shopId_shopifyCompanyId: { shopId: shop.id, shopifyCompanyId: company.id } },
    update: { name: company.name },
    create: { shopId: shop.id, shopifyCompanyId: company.id, name: company.name },
    select: { id: true },
  });

  // Reorder cards from real past orders — best-effort, never blocks the demo.
  let orders: DemoOrderRef[] = [];
  try {
    orders = await fetchDemoOrders(admin);
    for (const o of orders) {
      await prisma.reorderSource.upsert({
        where: { companyId_shopifyOrderId: { companyId: companyRow.id, shopifyOrderId: o.id } },
        update: {},
        create: {
          companyId: companyRow.id,
          shopifyOrderId: o.id,
          orderName: o.name,
          orderedAt: new Date(o.createdAt),
          total: o.amount,
          currency: o.currencyCode,
        },
      });
    }
  } catch (error) {
    const { captureException } = await import("../lib/sentry.server");
    captureException(error);
  }

  // Sweep stale visitor buyers (their quotes cascade). Best-effort.
  try {
    await sweepDemoBuyers(companyRow.id, now);
  } catch (error) {
    const { captureException } = await import("../lib/sentry.server");
    captureException(error);
  }

  const buyer = await prisma.buyer.create({
    data: {
      companyId: companyRow.id,
      email: demoBuyerEmail(options.random),
      name: DEMO_BUYER_NAME,
      shopifyContactId: company.contactId,
      shopifyCompanyLocationId: company.locationId,
    },
    select: { id: true },
  });

  // Sample quotes + invoice so the portal isn't empty — best-effort.
  try {
    const catalogFor = options.catalogFor ?? defaultCatalogFor;
    const catalog = await catalogFor(domain);
    await seedDemoBuyerData({
      shopId: shop.id,
      companyId: companyRow.id,
      buyerId: buyer.id,
      catalog,
      orders,
      termsDays: shop.defaultTermsDays,
      now,
    });
  } catch (error) {
    const { captureException } = await import("../lib/sentry.server");
    captureException(error);
  }

  return { ok: true, buyerId: buyer.id };
}

async function defaultCatalogFor(shopDomain: string): Promise<DemoCatalogItem[]> {
  const { getCatalog } = await import("./catalog.server");
  return getCatalog(shopDomain);
}

/** Delete demo visitor buyers older than the TTL. Returns the count removed. */
export async function sweepDemoBuyers(companyId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEMO_BUYER_TTL_DAYS * 24 * 60 * 60 * 1000);
  const res = await prisma.buyer.deleteMany({
    where: { companyId, email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` }, createdAt: { lt: cutoff } },
  });
  return res.count;
}

async function defaultAdminFor(shopDomain: string): Promise<AdminGraphql> {
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shopDomain);
  return admin as unknown as AdminGraphql;
}
