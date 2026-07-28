// F12 — pure sales-rep logic: data-isolation checks, the leaderboard rollup, and
// impersonation copy. No Prisma, no network — unit-tested. The service
// (rep.server.ts) does the DB work; gating helpers live in app/lib/billing.ts.

/**
 * Strict isolation: a rep may only act on companies explicitly assigned to them.
 * The single source of truth for "can this rep touch this company?". Pure.
 */
export function repCanAccessCompany(assignedCompanyIds: string[], companyId: string): boolean {
  return assignedCompanyIds.includes(companyId);
}

export interface RepQuoteRow {
  placedByRepId: string | null;
  status: string;
}

export interface LeaderboardRow {
  repId: string;
  name: string;
  email: string;
  quotes: number;
  orders: number; // quotes that became orders (accepted/ordered)
  winRate: number; // orders / quotes, 0..1
}

// A quote counts as a won "order" once it's been accepted or turned into a draft
// order. Kept here so the leaderboard and any copy agree on the definition.
const WON_STATUSES = new Set(["ACCEPTED", "ORDERED"]);

/**
 * Build the rep leaderboard from quotes attributed to reps. Reps with no
 * attributed quotes still appear (0/0) so a newly-active rep isn't invisible.
 * Sorted by orders desc, then quotes desc, then name. Pure.
 */
export function buildRepLeaderboard(
  reps: Array<{ id: string; name: string | null; email: string }>,
  quotes: RepQuoteRow[],
): LeaderboardRow[] {
  const byRep = new Map<string, { quotes: number; orders: number }>();
  for (const rep of reps) byRep.set(rep.id, { quotes: 0, orders: 0 });

  for (const q of quotes) {
    if (!q.placedByRepId) continue;
    const agg = byRep.get(q.placedByRepId);
    if (!agg) continue; // quote by a since-deleted rep — ignore
    agg.quotes += 1;
    if (WON_STATUSES.has(q.status)) agg.orders += 1;
  }

  const rows: LeaderboardRow[] = reps.map((rep) => {
    const agg = byRep.get(rep.id)!;
    return {
      repId: rep.id,
      name: rep.name ?? rep.email,
      email: rep.email,
      quotes: agg.quotes,
      orders: agg.orders,
      winRate: agg.quotes > 0 ? agg.orders / agg.quotes : 0,
    };
  });

  rows.sort((a, b) => b.orders - a.orders || b.quotes - a.quotes || a.name.localeCompare(b.name));
  return rows;
}

/** Banner text shown while a rep is acting on behalf of a buyer. Pure. */
export function impersonationBannerText(buyerLabel: string, companyName: string): string {
  return `Ordering on behalf of ${buyerLabel} · ${companyName}`;
}
