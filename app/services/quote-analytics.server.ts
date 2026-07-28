import prisma from "../db.server";
import {
  computeKpis,
  dailySeries,
  topAccounts,
  discountLeaderboard,
  type QuoteRecord,
  type QuoteStatusLite,
  type LineDiscount,
  type Kpis,
} from "../lib/analytics-quotes";

/**
 * F7 — negotiation analytics. Derives records from Quote (+ F3 price lists for
 * discount) and the store currency. All money is in ONE currency per shop; we
 * never mix currencies in a total (guardrail).
 */

const DAY_MS = 86_400_000;
const TERMINAL: QuoteStatusLite[] = ["ACCEPTED", "ORDERED", "EXPIRED"];

async function shopCurrency(shopId: string): Promise<string> {
  const list = await prisma.priceList.findFirst({
    where: { shopId, isDefault: true },
    select: { currency: true },
  });
  return list?.currency ?? "USD";
}

interface BuiltRecords {
  records: QuoteRecord[];
  lineDiscounts: LineDiscount[];
}

/** Load quotes since `since` and turn them into analytics records. */
async function buildRecords(shopId: string, since: Date): Promise<BuiltRecords> {
  const quotes = await prisma.quote.findMany({
    where: { company: { shopId }, createdAt: { gte: since } },
    include: { lines: true, company: { select: { id: true, name: true } } },
  });

  // Price-list context for discount vs the customer's list price (F3).
  const companyIds = [...new Set(quotes.map((q) => q.companyId))];
  const assignments = companyIds.length
    ? await prisma.companyPriceList.findMany({
        where: { companyId: { in: companyIds } },
        include: { priceList: { include: { entries: true } } },
      })
    : [];
  const listByCompany = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    const m = new Map<string, number>();
    for (const e of a.priceList.entries) m.set(e.variantId, Number(e.price));
    listByCompany.set(a.companyId, m);
  }

  const records: QuoteRecord[] = [];
  const lineDiscounts: LineDiscount[] = [];

  for (const q of quotes) {
    let value = 0;
    let discWeighted = 0;
    let discValue = 0;
    const listMap = listByCompany.get(q.companyId);
    for (const line of q.lines) {
      const linePrice = Number(line.price);
      const lineValue = linePrice * line.quantity;
      value += lineValue;
      const listPrice = listMap?.get(line.variantId);
      if (listPrice && listPrice > 0) {
        const d = Math.max(0, (listPrice - linePrice) / listPrice);
        discWeighted += d * lineValue;
        discValue += lineValue;
        lineDiscounts.push({ variantId: line.variantId, title: line.title, discountPct: d, value: lineValue });
      }
    }
    records.push({
      id: q.id,
      companyId: q.company.id,
      companyName: q.company.name,
      status: q.status as QuoteStatusLite,
      value,
      discountPct: discValue > 0 ? discWeighted / discValue : null,
      createdAt: q.createdAt,
      closedAt: TERMINAL.includes(q.status as QuoteStatusLite) ? q.updatedAt : null,
    });
  }

  return { records, lineDiscounts };
}

export interface AnalyticsView {
  currency: string;
  count: number;
  kpis: Kpis;
  series: ReturnType<typeof dailySeries>;
  topAccounts: ReturnType<typeof topAccounts>;
  discountLeaders: ReturnType<typeof discountLeaderboard>;
  stale: Array<{ id: string; companyName: string; value: number; ageDays: number }>;
}

export async function getAnalytics(
  shopDomain: string,
  rangeDays: number,
  now: Date = new Date(),
): Promise<AnalyticsView | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return null;
  const since = new Date(now.getTime() - rangeDays * DAY_MS);
  const { records, lineDiscounts } = await buildRecords(shop.id, since);
  const currency = await shopCurrency(shop.id);

  const stale = records
    .filter((r) => (r.status === "SUBMITTED" || r.status === "COUNTERED"))
    .map((r) => ({
      id: r.id,
      companyName: r.companyName,
      value: r.value,
      ageDays: Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / DAY_MS),
    }))
    .filter((r) => r.ageDays >= 7)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 10);

  return {
    currency,
    count: records.length,
    kpis: computeKpis(records),
    series: dailySeries(records, rangeDays, now),
    topAccounts: topAccounts(records, 5),
    discountLeaders: discountLeaderboard(lineDiscounts, 5),
    stale,
  };
}

/** CSV of the underlying quotes for the range. */
export async function exportQuotesCsv(shopDomain: string, rangeDays: number, now: Date = new Date()): Promise<string> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return "quote_id,company,status,value,discount_pct,created_at,closed_at\n";
  const since = new Date(now.getTime() - rangeDays * DAY_MS);
  const { records } = await buildRecords(shop.id, since);
  const rows = ["quote_id,company,status,value,discount_pct,created_at,closed_at"];
  for (const r of records) {
    const company = `"${r.companyName.replace(/"/g, '""')}"`;
    const disc = r.discountPct == null ? "" : (r.discountPct * 100).toFixed(1);
    const closed = r.closedAt ? new Date(r.closedAt).toISOString() : "";
    rows.push(`${r.id},${company},${r.status},${r.value.toFixed(2)},${disc},${new Date(r.createdAt).toISOString()},${closed}`);
  }
  return rows.join("\n") + "\n";
}

/** Build + upsert the QuoteMetricDaily row for one day (cron). */
export async function computeAndStoreDaily(shopDomain: string, day: Date): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return;
  const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const dayStr = dayStart.toISOString().slice(0, 10);
  // Pull a wide window so closes that started earlier are available.
  const { records } = await buildRecords(shop.id, new Date(dayStart.getTime() - 120 * DAY_MS));

  const createdToday = records.filter((r) => new Date(r.createdAt).toISOString().slice(0, 10) === dayStr);
  const closedToday = records.filter((r) => r.closedAt && new Date(r.closedAt).toISOString().slice(0, 10) === dayStr);
  const kpis = computeKpis(createdToday);

  await prisma.quoteMetricDaily.upsert({
    where: { shopId_date: { shopId: shop.id, date: dayStart } },
    create: {
      shopId: shop.id,
      date: dayStart,
      quotesCreated: createdToday.length,
      quotesWon: closedToday.filter((r) => r.status === "ACCEPTED" || r.status === "ORDERED").length,
      quotesLost: closedToday.filter((r) => r.status === "EXPIRED").length,
      quotesExpired: closedToday.filter((r) => r.status === "EXPIRED").length,
      quoteValueTotal: kpis.totalValue.toFixed(4),
      discountPctAvg: kpis.avgDiscountPct ?? 0,
      timeToCloseHrsAvg: kpis.avgTimeToCloseHrs ?? 0,
    },
    update: {
      quotesCreated: createdToday.length,
      quotesWon: closedToday.filter((r) => r.status === "ACCEPTED" || r.status === "ORDERED").length,
      quotesLost: closedToday.filter((r) => r.status === "EXPIRED").length,
      quotesExpired: closedToday.filter((r) => r.status === "EXPIRED").length,
      quoteValueTotal: kpis.totalValue.toFixed(4),
      discountPctAvg: kpis.avgDiscountPct ?? 0,
      timeToCloseHrsAvg: kpis.avgTimeToCloseHrs ?? 0,
    },
  });
}

/** Rollup yesterday for every Growth shop (cron entrypoint helper). */
export async function rollupAllShops(now: Date = new Date()): Promise<number> {
  const shops = await prisma.shop.findMany({ where: { plan: "GROWTH" }, select: { shopifyDomain: true } });
  const yesterday = new Date(now.getTime() - DAY_MS);
  let n = 0;
  for (const s of shops) {
    await computeAndStoreDaily(s.shopifyDomain, yesterday);
    n++;
  }
  return n;
}
