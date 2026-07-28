// Client-safe billing constants + pure gating logic. Kept out of
// billing.server.ts so route components can reference plan names, pricing, and
// gating (planMeets/featureAccess) in render without pulling server-only code
// (Prisma, the Shopify SDK) into the client bundle.

// Plan names are the keys Shopify stores against the subscription; keep them
// stable — changing a key orphans existing subscriptions.
export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";

export type PlanName = typeof STARTER_PLAN | typeof GROWTH_PLAN;

export const TRIAL_DAYS = 14;

/** Display pricing, also the source of truth for the billing charge. */
export const PLAN_PRICING = {
  [STARTER_PLAN]: { amount: 29, currencyCode: "USD" as const },
  [GROWTH_PLAN]: { amount: 79, currencyCode: "USD" as const },
};

export interface BillingStatus {
  /** The active PAID plan, or null when on trial / no active payment. */
  plan: PlanName | null;
  /** Whether Shopify reports any active payment for the store. */
  hasActivePayment: boolean;
  /** True while no paid subscription is active (trial period or lapsed). */
  onTrial: boolean;
  /** The raw active subscription name, if any (for logging/telemetry). */
  activeSubscriptionName: string | null;
  /** The active subscription's Shopify id — needed to cancel it. */
  activeSubscriptionId: string | null;
}

// --- plan gating -------------------------------------------------------------

/** Higher rank includes everything below it. Growth ⊃ Starter. */
export const PLAN_RANK: Record<PlanName, number> = {
  [STARTER_PLAN]: 1,
  [GROWTH_PLAN]: 2,
};

/** Does the current plan satisfy (meet or exceed) the required plan? Pure. */
export function planMeets(current: PlanName | null, required: PlanName): boolean {
  if (!current) return false;
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

export type AccessReason = "ok" | "no-plan" | "upgrade-required";

export interface FeatureAccess {
  allowed: boolean;
  reason: AccessReason;
  required: PlanName;
}

/** Pure gating decision for a feature that needs `required`. */
export function featureAccess(
  status: BillingStatus,
  required: PlanName,
): FeatureAccess {
  if (!status.plan) return { allowed: false, reason: "no-plan", required };
  if (!planMeets(status.plan, required)) {
    return { allowed: false, reason: "upgrade-required", required };
  }
  return { allowed: true, reason: "ok", required };
}

export interface GrowthFeature {
  key: string;
  name: string;
  description: string;
}

/**
 * No feature is locked behind Growth. Every feature (quote builder, portal, net
 * terms, AI Order Pad, reorder) is available on both paid tiers. The tiers
 * differ ONLY on enforceable limits (see PLAN_LIMITS below). Kept as an empty
 * exported array so existing importers don't break.
 */
export const GROWTH_FEATURES: GrowthFeature[] = [];

// --- plan limits (the real Starter vs Growth difference) ---------------------

export interface PlanLimits {
  /** Rolling cap of active quotes per 30-day window. Infinity = unlimited. */
  activeQuoteCap: number;
  /** Maximum staff seats for the store. */
  seatCap: number;
  /** F3: maximum number of price lists. Infinity = unlimited. */
  priceListCap: number;
  /** F4: maximum saved order lists per company. Infinity = unlimited. */
  savedListCap: number;
  /** F5: maximum buyer members per company. Infinity = unlimited. */
  memberCap: number;
  /** F6: maximum wholesale application forms. Infinity = unlimited. */
  wholesaleFormCap: number;
  /** F8: maximum follow-up nudges in a quote's cadence. Starter = 1 (manual). */
  followupCadenceMax: number;
  /** F11: maximum CUSTOM catalogs (the default catalog is not counted). */
  customCatalogCap: number;
  /** F12: maximum sales-rep seats. Starter = 0 (feature hidden). */
  repSeatCap: number;
  /** F16: additional currencies beyond the store default. Starter = 1. */
  extraCurrencyCap: number;
  /** F16: maximum enabled locales. Starter = 2 (EN + AR). */
  localeCap: number;
}

/** How far back the "active quotes" window looks. */
export const ACTIVE_QUOTE_WINDOW_DAYS = 30;

export const PLAN_LIMITS = {
  starter: { activeQuoteCap: 50, seatCap: 1, priceListCap: 3, savedListCap: 3, memberCap: 1, wholesaleFormCap: 1, followupCadenceMax: 1, customCatalogCap: 1, repSeatCap: 0, extraCurrencyCap: 1, localeCap: 2 },
  growth: { activeQuoteCap: Infinity, seatCap: 5, priceListCap: Infinity, savedListCap: Infinity, memberCap: 5, wholesaleFormCap: Infinity, followupCadenceMax: 6, customCatalogCap: Infinity, repSeatCap: 3, extraCurrencyCap: Infinity, localeCap: 3 },
} as const satisfies Record<"starter" | "growth", PlanLimits>;

/**
 * Limits for a plan. Accepts the Prisma `Plan` enum ("GROWTH"/"STARTER"/…) or a
 * PlanName ("Growth"/"Starter"). Only Growth gets the higher limits; Starter,
 * trial, cancelled, and unknown all fall back to Starter limits.
 */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return plan === "GROWTH" || plan === GROWTH_PLAN
    ? PLAN_LIMITS.growth
    : PLAN_LIMITS.starter;
}

export interface QuoteAllowance {
  allowed: boolean;
  used: number;
  cap: number;
}

/** Pure allowance decision: a new quote is allowed while used < cap. */
export function evaluateQuoteAllowance(used: number, cap: number): QuoteAllowance {
  return { allowed: used < cap, used, cap };
}

export interface SeatAllowance {
  allowed: boolean;
  used: number;
  cap: number;
}

/** Merchant-facing copy when the quote cap is hit (they can upgrade). */
export function quoteCapMessage(cap: number): string {
  return `You've reached your Starter plan limit of ${cap} active quotes this month. Upgrade to Growth for unlimited quotes.`;
}

/** Buyer-facing copy when the store's quote cap is hit (they can't upgrade). */
export const QUOTE_CAP_BUYER_MESSAGE =
  "This store can't take a new quote request right now. Please reach out to them to continue.";

/** Merchant-facing copy when the seat cap is hit. */
export function seatCapMessage(cap: number): string {
  return `Your Starter plan includes ${cap} staff seat. Upgrade to Growth for up to ${PLAN_LIMITS.growth.seatCap} seats.`;
}

/** Pure allowance decision for creating another price list. */
export function evaluatePriceListAllowance(used: number, cap: number): { allowed: boolean; used: number; cap: number } {
  return { allowed: used < cap, used, cap };
}

/** Merchant-facing copy when the price-list cap is hit. */
export function priceListCapMessage(cap: number): string {
  return `Your Starter plan includes ${cap} price lists. Upgrade to Growth for unlimited price lists, volume breaks, and CSV import.`;
}

/** Pure allowance decision for creating another saved order list. */
export function evaluateSavedListAllowance(used: number, cap: number): { allowed: boolean; used: number; cap: number } {
  return { allowed: used < cap, used, cap };
}

// --- F9 order-rule scope gating ----------------------------------------------

export type RuleScopeName = "STORE" | "COLLECTION" | "PRODUCT" | "CUSTOMER_GROUP";

/**
 * Which order-rule scopes a plan may create. Starter = store minimum + product
 * MOQ; Growth adds collection + customer-group scopes (and pack multiples + CSV,
 * gated separately). Pure.
 */
export function allowedRuleScopes(plan: string | null | undefined): RuleScopeName[] {
  const isGrowth = plan === "GROWTH" || plan === GROWTH_PLAN;
  return isGrowth
    ? ["STORE", "PRODUCT", "COLLECTION", "CUSTOMER_GROUP"]
    : ["STORE", "PRODUCT"];
}

/** Pack/case-size multiples + CSV import are Growth-only. Pure. */
export function packRulesAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

// --- F10 accounting sync gating ----------------------------------------------

/** Accounting sync (QuickBooks Online / Xero) is Growth-only. Pure. */
export function accountingSyncAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

// --- F11 custom catalog gating -----------------------------------------------

export type CatalogAssignmentScope = "COMPANY" | "GROUP" | "MEMBER";

/**
 * Which assignment scopes a plan may use. Starter can assign a catalog at the
 * company level only; Growth adds group (customer tag) and member-level
 * targeting. Pure.
 */
export function catalogAssignmentScopes(plan: string | null | undefined): CatalogAssignmentScope[] {
  const isGrowth = plan === "GROWTH" || plan === GROWTH_PLAN;
  return isGrowth ? ["COMPANY", "GROUP", "MEMBER"] : ["COMPANY"];
}

/** CSV catalog import is Growth-only. Pure. */
export function catalogCsvAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

/** Pure allowance decision for creating another custom catalog. */
export function evaluateCatalogAllowance(used: number, cap: number): { allowed: boolean; used: number; cap: number } {
  return { allowed: used < cap, used, cap };
}

/** Merchant-facing copy when the custom-catalog cap is hit. */
export function catalogCapMessage(cap: number): string {
  return `Your Starter plan includes ${cap} custom catalog. Upgrade to Growth for unlimited catalogs plus group- and member-level assignment and CSV import.`;
}

// --- F12 sales-rep portal gating ---------------------------------------------

/** The sales-rep portal (order-on-behalf + assigned accounts) is Growth-only. */
export function repPortalAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

/** Flexible payments (deposits / installments / pay-by-link) are Growth-only. */
export function flexPayAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

// --- F14 tax / VAT gating ----------------------------------------------------
// Basic tax (single default rate + a manual per-company exempt toggle) is on
// BOTH plans. Growth adds the certificate workflow, tax-ID validation, per-region
// rules, and compliant invoice numbering.

/** Per-region tax rules are Growth-only. Pure. */
export function taxRegionsAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

/** The certificate + verification workflow (and ID validation) is Growth-only. Pure. */
export function taxCertWorkflowAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

/** Compliant sequential invoice numbering is Growth-only. Pure. */
export function compliantInvoiceNumbering(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

// --- F15 ERP / inventory sync gating -----------------------------------------

/** ERP / inventory sync (stock in, orders out) is Growth-only. Pure. */
export function erpSyncAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

// --- F16 i18n / multi-currency gating ----------------------------------------

/**
 * Fixed contract rates + per-currency price-list overrides are Growth-only.
 * (Both plans get display-conversion via a rate.) Pure.
 */
export function contractRatesAllowed(plan: string | null | undefined): boolean {
  return plan === "GROWTH" || plan === GROWTH_PLAN;
}

/** Pure allowance decision for enabling another currency (beyond the store default). */
export function evaluateCurrencyAllowance(usedExtra: number, cap: number): { allowed: boolean; used: number; cap: number } {
  return { allowed: usedExtra < cap, used: usedExtra, cap };
}

/** Merchant-facing copy when the extra-currency cap is hit. */
export function currencyCapMessage(cap: number): string {
  return `Your Starter plan includes the store currency plus ${cap} more. Upgrade to Growth for unlimited currencies and fixed contract rates.`;
}

/** Pure allowance decision for inviting another sales rep. */
export function evaluateRepSeatAllowance(used: number, cap: number): { allowed: boolean; used: number; cap: number } {
  return { allowed: used < cap, used, cap };
}

/** Merchant-facing copy when the rep-seat cap is hit. */
export function repSeatCapMessage(cap: number): string {
  return `Your plan includes ${cap} sales-rep seats. Contact us to add more reps.`;
}

/** Buyer-facing copy when the saved-list cap is hit. */
export function savedListCapMessage(cap: number): string {
  return `This store's plan allows ${cap} saved lists. Ask them to upgrade for unlimited saved lists and CSV upload.`;
}
