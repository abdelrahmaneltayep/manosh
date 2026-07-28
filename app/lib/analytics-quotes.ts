// F7 — client-safe, pure negotiation-analytics logic. The service builds
// QuoteRecord[] from the DB (value + discount via F3 pricing); these functions
// turn them into KPIs, sparkline series, and tables. Unit-tested.

export type QuoteStatusLite = "SUBMITTED" | "COUNTERED" | "ACCEPTED" | "ORDERED" | "EXPIRED";

/** Enough history before the dashboard is useful (else show the empty state). */
export const MIN_QUOTES_FOR_ANALYTICS = 5;

export interface QuoteRecord {
  id: string;
  companyId: string;
  companyName: string;
  status: QuoteStatusLite;
  /** Quote value in the store currency (never mix currencies — see the service). */
  value: number;
  /** Negotiated discount vs the customer's list price, or null when unknown. */
  discountPct: number | null;
  createdAt: string | Date;
  /** When it reached a terminal state, or null if still open. */
  closedAt: string | Date | null;
}

export function isWon(s: QuoteStatusLite): boolean {
  return s === "ACCEPTED" || s === "ORDERED";
}
export function isLost(s: QuoteStatusLite): boolean {
  return s === "EXPIRED";
}
export function isOpen(s: QuoteStatusLite): boolean {
  return s === "SUBMITTED" || s === "COUNTERED";
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Win rate = won / (won + lost). Null when nothing has closed. Pure. */
export function winRate(records: QuoteRecord[]): number | null {
  let won = 0;
  let lost = 0;
  for (const r of records) {
    if (isWon(r.status)) won++;
    else if (isLost(r.status)) lost++;
  }
  const closed = won + lost;
  return closed === 0 ? null : won / closed;
}

/** Average negotiated discount across won quotes with a known discount. */
export function avgDiscountPct(records: QuoteRecord[]): number | null {
  const ds = records.filter((r) => isWon(r.status) && r.discountPct != null).map((r) => r.discountPct as number);
  return mean(ds);
}

/** Average hours from created to closed, across won quotes. */
export function avgTimeToCloseHrs(records: QuoteRecord[]): number | null {
  const hrs: number[] = [];
  for (const r of records) {
    if (!isWon(r.status) || !r.closedAt) continue;
    const dt = new Date(r.closedAt).getTime() - new Date(r.createdAt).getTime();
    if (Number.isFinite(dt) && dt >= 0) hrs.push(dt / HOUR_MS);
  }
  return mean(hrs);
}

/** Sum of value of still-open quotes (the pipeline). */
export function openPipelineValue(records: QuoteRecord[]): number {
  return records.filter((r) => isOpen(r.status)).reduce((s, r) => s + r.value, 0);
}

export interface Kpis {
  count: number;
  won: number;
  lost: number;
  winRate: number | null;
  avgDiscountPct: number | null;
  avgTimeToCloseHrs: number | null;
  openPipeline: number;
  totalValue: number;
}

export function computeKpis(records: QuoteRecord[]): Kpis {
  return {
    count: records.length,
    won: records.filter((r) => isWon(r.status)).length,
    lost: records.filter((r) => isLost(r.status)).length,
    winRate: winRate(records),
    avgDiscountPct: avgDiscountPct(records),
    avgTimeToCloseHrs: avgTimeToCloseHrs(records),
    openPipeline: openPipelineValue(records),
    totalValue: records.reduce((s, r) => s + r.value, 0),
  };
}

export interface AccountRow {
  companyId: string;
  companyName: string;
  value: number;
  count: number;
}

/** Top accounts by total quote value. Pure. */
export function topAccounts(records: QuoteRecord[], n = 5): AccountRow[] {
  const map = new Map<string, AccountRow>();
  for (const r of records) {
    const row = map.get(r.companyId) ?? { companyId: r.companyId, companyName: r.companyName, value: 0, count: 0 };
    row.value += r.value;
    row.count += 1;
    map.set(r.companyId, row);
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, n);
}

export interface DayPoint {
  date: string; // YYYY-MM-DD
  created: number;
  won: number;
  value: number;
}

/** Per-day series over the last `rangeDays` (inclusive of today). Pure. */
export function dailySeries(records: QuoteRecord[], rangeDays: number, now: Date): DayPoint[] {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const points: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    const p = { date: d, created: 0, won: 0, value: 0 };
    points.push(p);
    index.set(d, p);
  }
  for (const r of records) {
    const d = new Date(r.createdAt).toISOString().slice(0, 10);
    const p = index.get(d);
    if (!p) continue;
    p.created += 1;
    p.value += r.value;
    if (isWon(r.status)) p.won += 1;
  }
  return points;
}

export interface LineDiscount {
  variantId: string;
  title: string;
  discountPct: number;
  value: number;
}
export interface DiscountLeaderRow {
  variantId: string;
  title: string;
  avgDiscountPct: number;
  value: number;
  lines: number;
}

/** SKUs that get discounted most (value-weighted avg discount). Pure. */
export function discountLeaderboard(lines: LineDiscount[], n = 5): DiscountLeaderRow[] {
  const map = new Map<string, { title: string; wsum: number; vsum: number; lines: number }>();
  for (const l of lines) {
    const row = map.get(l.variantId) ?? { title: l.title, wsum: 0, vsum: 0, lines: 0 };
    row.wsum += l.discountPct * l.value;
    row.vsum += l.value;
    row.lines += 1;
    map.set(l.variantId, row);
  }
  return [...map.entries()]
    .map(([variantId, r]) => ({
      variantId,
      title: r.title,
      avgDiscountPct: r.vsum > 0 ? r.wsum / r.vsum : 0,
      value: r.vsum,
      lines: r.lines,
    }))
    .sort((a, b) => b.avgDiscountPct - a.avgDiscountPct)
    .slice(0, n);
}
