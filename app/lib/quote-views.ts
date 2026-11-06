// Saved views for the Quotes inbox (App Home index pattern: view tabs + search).
// URL-driven (?view=&q=&page=) so the browser back button, deep links from Home
// ("Needs your attention") and bookmarks all land on the same view. Pure.
import type { QuoteStatus } from "@prisma/client";

export interface QuoteView {
  id: string;
  label: string;
  statuses: QuoteStatus[] | null; // null = every status
}

export const QUOTE_VIEWS: QuoteView[] = [
  { id: "all", label: "All", statuses: null },
  { id: "needs-reply", label: "Needs reply", statuses: ["SUBMITTED"] },
  { id: "open", label: "Open", statuses: ["SUBMITTED", "COUNTERED"] },
  { id: "accepted", label: "Accepted", statuses: ["ACCEPTED"] },
  { id: "ordered", label: "Ordered", statuses: ["ORDERED"] },
  { id: "expired", label: "Expired", statuses: ["EXPIRED"] },
];

export const QUOTES_PER_PAGE = 25;

export function viewById(id: string | null | undefined): QuoteView {
  return QUOTE_VIEWS.find((v) => v.id === id) ?? QUOTE_VIEWS[0];
}

interface Filterable {
  displayStatus: QuoteStatus;
  companyName: string;
  buyerEmail: string;
}

/** Quotes in a view that match the search (company or buyer email, case-insensitive). */
export function filterQuotes<T extends Filterable>(quotes: T[], viewId: string, query: string): T[] {
  const view = viewById(viewId);
  const q = query.trim().toLowerCase();
  return quotes.filter(
    (x) =>
      (!view.statuses || view.statuses.includes(x.displayStatus)) &&
      (!q || x.companyName.toLowerCase().includes(q) || x.buyerEmail.toLowerCase().includes(q)),
  );
}

/** How many quotes each view holds (for the tab badges), ignoring the search. */
export function viewCounts<T extends Filterable>(quotes: T[]): Record<string, number> {
  return Object.fromEntries(QUOTE_VIEWS.map((v) => [v.id, filterQuotes(quotes, v.id, "").length]));
}

export function paginate<T>(rows: T[], page: number, per = QUOTES_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((p - 1) * per, p * per), page: p, pages, hasPrev: p > 1, hasNext: p < pages };
}
