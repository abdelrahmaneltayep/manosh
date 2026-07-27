// Client-safe, pure aging + credit-bucket logic. Kept out of *.server so the
// aging dashboard can render buckets without pulling Prisma into the client
// bundle. Money is handled as numbers here only for bucketing/summing display
// values — the authoritative amounts are the Decimal snapshots in the DB.

export type AgingBucket = "current" | "1-30" | "31-60" | "60+";

export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "60+"];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "60+": "60+ days",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days `now` is past `dueDate` (negative/zero when not yet due). */
export function daysOverdue(dueDate: Date | string, now: Date | string): number {
  const due = new Date(dueDate).getTime();
  const at = new Date(now).getTime();
  return Math.floor((at - due) / DAY_MS);
}

/** Which aging bucket an invoice falls in, by how overdue it is. Pure. */
export function agingBucket(dueDate: Date | string, now: Date | string): AgingBucket {
  const d = daysOverdue(dueDate, now);
  if (d <= 0) return "current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  return "60+";
}

export interface AgingInvoice {
  amount: number;
  dueDate: Date | string;
  status: string; // OPEN | OVERDUE | PAID | VOID
}

export type AgingTotals = Record<AgingBucket, number>;

/** Sum outstanding (OPEN/OVERDUE) amounts into the four aging buckets. Pure. */
export function bucketInvoices(invoices: AgingInvoice[], now: Date | string): AgingTotals {
  const totals: AgingTotals = { current: 0, "1-30": 0, "31-60": 0, "60+": 0 };
  for (const inv of invoices) {
    if (inv.status !== "OPEN" && inv.status !== "OVERDUE") continue;
    totals[agingBucket(inv.dueDate, now)] += inv.amount;
  }
  return totals;
}

/** Total outstanding across all buckets. */
export function totalOutstanding(totals: AgingTotals): number {
  return AGING_BUCKETS.reduce((sum, b) => sum + totals[b], 0);
}
