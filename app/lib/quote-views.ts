// Saved views for the Quotes inbox (App Home index pattern: view tabs + search).
// URL-driven (?view=&q=&page=) so the browser back button, deep links from Home
// ("Needs your attention") and bookmarks all land on the same view. Pure.
import type { QuoteStatus } from "@prisma/client";

export interface QuoteView {
  id: string;
  label: string;
  statuses: QuoteStatus[] | null; // null = every status
  /** "offers" lists Make an Offer offers instead of quotes. */
  kind?: "offers";
  /** Only shown when this part of the app is on. */
  needs?: "offers" | "followups";
}

export const QUOTE_VIEWS: QuoteView[] = [
  { id: "all", label: "All", statuses: null },
  { id: "needs-reply", label: "Needs reply", statuses: ["SUBMITTED"] },
  // Follow-ups: quotes you've priced that wait on the buyer; bulk "Send reminder".
  { id: "waiting", label: "Waiting on buyer", statuses: ["COUNTERED"] },
  { id: "open", label: "Open", statuses: ["SUBMITTED", "COUNTERED"] },
  { id: "offers", label: "Offers", statuses: [], kind: "offers", needs: "offers" },
  { id: "accepted", label: "Accepted", statuses: ["ACCEPTED"] },
  { id: "ordered", label: "Ordered", statuses: ["ORDERED"] },
  { id: "expired", label: "Expired", statuses: ["EXPIRED"] },
];

export const QUOTES_PER_PAGE = 25;

export function viewById(id: string | null | undefined, available: QuoteView[] = QUOTE_VIEWS): QuoteView {
  return available.find((v) => v.id === id) ?? available[0];
}

/** The views this shop can use (Offers only where Make an Offer is on and in the plan). */
export function availableViews(on: { offers: boolean; followups: boolean }): QuoteView[] {
  return QUOTE_VIEWS.filter((v) => !v.needs || on[v.needs]);
}

/** Which section tab is lit: the Offers and Follow-ups tabs open these views. */
export function sectionTabFor(viewId: string): "quotes" | "offers" | "followups" {
  return viewId === "offers" ? "offers" : viewId === "waiting" ? "followups" : "quotes";
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
