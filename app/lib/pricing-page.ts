// Public pricing page data, derived from the v3 ladder in billing-v3.ts so the
// marketing page and the billing config can never drift. Pure, no React.
import {
  PLANS,
  PLAN_CAPABILITIES,
  PLAN_DISPLAY_NAME,
  PLAN_PRICING_V3,
  formatPriceCents,
  type PlanHandle,
} from "./billing-v3";

export interface PricingCard {
  handle: PlanHandle;
  name: string;
  monthly: string;
  /** Per-month equivalent when billed annually (annual ÷ 12); null for free. */
  annualPerMonth: string | null;
  /** The yearly total, e.g. "$90"; null for free. */
  annualTotal: string | null;
  trialDays: number;
  recommended: boolean;
  blurb: string;
  bullets: string[];
}

const BLURB: Record<PlanHandle, string> = {
  free: "Try the whole loop on a few quotes.",
  starter: "Unlimited quotes for a small wholesale desk.",
  growth: "AI counters, net terms and the full analytics.",
  scale: "Reps, accounting sync and white-label.",
};

function cap(n: number): string {
  return Number.isFinite(n) ? String(n) : "Unlimited";
}

/** Cents → "$24.17" style, two decimals when fractional. */
export function formatPerMonth(cents: number): string {
  return formatPriceCents(Math.round(cents));
}

export function pricingCards(): PricingCard[] {
  return PLANS.map((handle) => {
    const price = PLAN_PRICING_V3[handle];
    const c = PLAN_CAPABILITIES[handle];
    const bullets: string[] = [];
    bullets.push(Number.isFinite(c.quotesCap) ? `${c.quotesCap} quotes per 30 days` : "Unlimited quotes");
    bullets.push(`${cap(c.companyAccountsCap)} company account${c.companyAccountsCap === 1 ? "" : "s"}`);
    if (c.priceListsCap > 0) bullets.push(`${cap(c.priceListsCap)} price list${c.priceListsCap === 1 ? "" : "s"}`);
    if (c.quickOrder) bullets.push("Quick order pad and one-tap reorder");
    if (c.aiCounter) bullets.push("Draft with Claude counter-offers");
    if (c.makeAnOffer === "manual") bullets.push(`Make an Offer with up to ${c.offerRuleCap} rules`);
    if (c.makeAnOffer === "auto") bullets.push("Make an Offer automation, unlimited rules");
    if (c.netTerms) bullets.push("Net terms and credit");
    if (c.deposits) bullets.push("Deposits and pay-by-link");
    if (c.analytics === "full") bullets.push("Full quote analytics");
    if (c.analytics === "deal") bullets.push("Deal-level analytics");
    if (c.salesRep) bullets.push("Sales-rep portal");
    if (c.accountingSync) bullets.push("QuickBooks and Xero sync");
    if (c.whiteLabel) bullets.push("White-label");
    return {
      handle,
      name: PLAN_DISPLAY_NAME[handle],
      monthly: formatPriceCents(price.monthlyCents),
      annualPerMonth: price.annualCents === null ? null : formatPerMonth(price.annualCents / 12),
      annualTotal: price.annualCents === null ? null : formatPriceCents(price.annualCents),
      trialDays: price.trialDays,
      recommended: handle === "growth",
      blurb: BLURB[handle],
      bullets,
    };
  });
}

export interface ComparisonRow {
  group: string;
  label: string;
  values: Record<PlanHandle, string>;
}

function row(group: string, label: string, pick: (h: PlanHandle) => string): ComparisonRow {
  const values = {} as Record<PlanHandle, string>;
  PLANS.forEach((h) => { values[h] = pick(h); });
  return { group, label, values };
}

const yes = (b: boolean) => (b ? "✓" : "–");

export function comparisonRows(): ComparisonRow[] {
  const C = PLAN_CAPABILITIES;
  const P = PLAN_PRICING_V3;
  return [
    row("Quotes", "Quotes and quote requests per 30 days", (h) => cap(C[h].quotesCap)),
    row("Quotes", "Quick order pad and one-tap reorder", (h) => yes(C[h].quickOrder)),
    row("Quotes", "Draft with Claude counter-offers", (h) => yes(C[h].aiCounter)),
    row("Quotes", "Make an Offer", (h) => C[h].makeAnOffer === "auto" ? "Automation · unlimited rules" : C[h].makeAnOffer === "manual" ? `Manual · ${C[h].offerRuleCap} rules` : "Teaser"),
    row("Companies and pricing", "Company accounts", (h) => cap(C[h].companyAccountsCap)),
    row("Companies and pricing", "Price lists", (h) => C[h].priceListsCap === 0 ? "–" : cap(C[h].priceListsCap)),
    row("Companies and pricing", "Net terms and credit", (h) => yes(C[h].netTerms)),
    row("Companies and pricing", "Deposits and pay-by-link", (h) => yes(C[h].deposits)),
    row("Team and integrations", "Analytics", (h) => ({ basic: "Basic", full: "Full", deal: "Deal-level" })[C[h].analytics]),
    row("Team and integrations", "Sales-rep portal", (h) => yes(C[h].salesRep)),
    row("Team and integrations", "QuickBooks and Xero sync", (h) => yes(C[h].accountingSync)),
    row("Team and integrations", "White-label", (h) => yes(C[h].whiteLabel)),
    row("Team and integrations", "Free trial", (h) => P[h].trialDays ? `${P[h].trialDays} days` : "–"),
  ];
}
