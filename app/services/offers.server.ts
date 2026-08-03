import type { OfferSource, OfferStatus, OfferRuleScope } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { getVariantCosts } from "./variant-cost.server";
import { getShopCapabilities } from "./billing.server";
import { submitRateOk } from "./wholesale.server";
import {
  evaluateOffer,
  pickRule,
  resolveAutoOutcome,
  agreedUnitPriceCents,
  type OfferRuleLite,
  type OfferDecision,
  type AutoOutcome,
} from "../lib/offers";
import {
  buildDraftOrderInput,
  createDraftOrder,
  type AdminGraphqlClient,
  type DraftLineInput,
  type DraftOrderTotals,
  type PurchasingEntityRef,
} from "./draft-order.server";

/**
 * F21 — Make an Offer service. Orchestrates offers, the negotiation thread, and
 * the merchant rules. The pricing/decision logic is the pure engine in
 * app/lib/offers.ts (which reuses the F1 margin idea against the variant-cost
 * baseline — no second pricing brain). Auto-execution (scale) + storefront +
 * conversion are PR-4; PR-3 ships the engine, the manual admin flow, and rules.
 * Dark-launched behind MANNON_FF_MAKE_AN_OFFER; gated growth+ per §1.3.
 */

export const MAKE_AN_OFFER_ENABLED = () => process.env.MANNON_FF_MAKE_AN_OFFER === "true";

export class OfferRuleCapError extends Error {
  constructor(public cap: number) {
    super("Offer rule cap reached");
  }
}
export class NotFoundError extends Error {}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

const cents = (n: number) => Math.round(n * 100);

export interface OfferLineInput {
  variantId: string;
  title?: string;
  sku?: string;
  quantity: number;
  listPrice: number; // per-unit list price in the shop currency
}

// --- rules → engine mapping --------------------------------------------------

function toRuleLite(r: {
  id: string; scope: OfferRuleScope; scopeRef: string | null;
  minAcceptPctOfList: unknown; autoDeclineBelowPctOfList: unknown;
  autoCounterToPctOfList: unknown; marginFloorPct: unknown; priority: number; active: boolean;
}): OfferRuleLite {
  return {
    id: r.id,
    scope: r.scope,
    scopeRef: r.scopeRef,
    minAcceptPctOfList: Number(r.minAcceptPctOfList),
    autoDeclineBelowPctOfList: Number(r.autoDeclineBelowPctOfList),
    autoCounterToPctOfList: r.autoCounterToPctOfList == null ? null : Number(r.autoCounterToPctOfList),
    marginFloorPct: Number(r.marginFloorPct),
    priority: r.priority,
    active: r.active,
  };
}

async function activeRuleLites(shopId: string): Promise<OfferRuleLite[]> {
  const rows = await prisma.offerRule.findMany({ where: { shopId, active: true }, orderBy: { priority: "desc" } });
  return rows.map(toRuleLite);
}

// --- create + evaluate -------------------------------------------------------

export interface CreateOfferInput {
  buyerEmail: string;
  companyId?: string | null;
  source?: OfferSource;
  lineItems: OfferLineInput[];
  offeredTotal: number;
}

export interface CreatedOffer {
  offerId: string;
  decision: OfferDecision;
  /** What actually happened: pending (Growth/manual), or an auto outcome (Scale). */
  outcome: AutoOutcome;
  costKnown: boolean;
}

const OUTCOME_STATUS: Record<Exclude<AutoOutcome, "pending">, { status: OfferStatus; event: "OFFER_ACCEPTED" | "OFFER_DECLINED" | "OFFER_COUNTERED"; note: string }> = {
  accepted: { status: "ACCEPTED", event: "OFFER_ACCEPTED", note: "Auto-accepted — margin-safe" },
  declined: { status: "DECLINED", event: "OFFER_DECLINED", note: "Auto-declined — below threshold" },
  countered: { status: "COUNTERED", event: "OFFER_COUNTERED", note: "Auto-countered" },
};

/**
 * Create an offer, evaluate it against the shop's rules, and — on Scale — execute
 * the decision automatically (auto-decline/accept/counter + PWYW), never breaching
 * the margin floor. On Growth it stays PENDING for the merchant. When any line's
 * cost is unknown we can't verify margin, so we never auto-commit (forced manual).
 */
export async function createOffer(shopDomain: string, input: CreateOfferInput): Promise<CreatedOffer | { error: string }> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true, minMarginPct: true } });
  if (!shop) return { error: "Unknown shop." };
  if (input.lineItems.length === 0) return { error: "No items on the offer." };

  const listTotal = input.lineItems.reduce((s, l) => s + l.listPrice * l.quantity, 0);
  // One batched cost read for all lines (§3.2 — no per-line N+1).
  const costMap = await getVariantCosts(shopDomain, input.lineItems.map((l) => l.variantId));
  let costTotal = 0;
  let costKnown = true;
  for (const l of input.lineItems) {
    const c = costMap.get(l.variantId);
    if (!c || c.costPrice == null) costKnown = false;
    else costTotal += c.costPrice * l.quantity;
  }

  const rules = await activeRuleLites(shop.id);
  const rule = pickRule(rules, { variantIds: input.lineItems.map((l) => l.variantId), customerGroup: input.companyId ?? null });

  const decision: OfferDecision = costKnown
    ? evaluateOffer({ listCents: cents(listTotal), offeredCents: cents(input.offeredTotal), costCents: cents(costTotal) }, rule)
    : { action: "manual", marginAtOffer: 0, reason: "Variant cost unknown — set costs to enable margin-safe automation." };

  // Scale auto-executes; Growth stays pending. PWYW handled inside resolveAutoOutcome.
  const caps = await getShopCapabilities(shopDomain);
  const isScale = caps.makeAnOffer === "auto";
  const outcome: AutoOutcome = costKnown ? resolveAutoOutcome(decision, isScale, shop.minMarginPct) : "pending";

  const auto = outcome === "pending" ? null : OUTCOME_STATUS[outcome];
  const counterTotal = outcome === "countered" && decision.counterCents != null ? decision.counterCents / 100 : null;

  const offer = await prisma.offer.create({
    data: {
      shopId: shop.id,
      buyerEmail: input.buyerEmail.trim().toLowerCase(),
      companyId: input.companyId ?? null,
      source: input.source ?? "PRODUCT",
      status: auto ? auto.status : "PENDING",
      handledBy: auto ? "AUTO" : null,
      currentCounterTotal: counterTotal,
      lineItems: input.lineItems as object,
      listPriceTotal: listTotal,
      offeredTotal: input.offeredTotal,
      marginAtOffer: costKnown ? decision.marginAtOffer : null,
      ruleId: rule?.id ?? null,
      messages: {
        create: [
          { actor: "BUYER" as const, amountTotal: input.offeredTotal, note: "Buyer's offer" },
          ...(auto ? [{ actor: "SYSTEM" as const, amountTotal: counterTotal, note: auto.note }] : []),
        ],
      },
    },
    select: { id: true },
  });

  await appendEvent({ shopId: shop.id, type: "OFFER_CREATED", entityType: "Offer", entityId: offer.id, payload: { suggested: decision.action, outcome } });
  if (auto) await appendEvent({ shopId: shop.id, type: auto.event, entityType: "Offer", entityId: offer.id, payload: { auto: true } });

  return { offerId: offer.id, decision, outcome, costKnown };
}

/** Recompute the engine's suggestion for an existing offer (for the admin display). */
export async function offerSuggestion(shopDomain: string, offerId: string): Promise<OfferDecision | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const offer = await prisma.offer.findFirst({ where: { id: offerId, shopId } });
  if (!offer) return null;
  const lines = (offer.lineItems as unknown as OfferLineInput[]) ?? [];
  // One batched cost read for all lines (§3.2 — no per-line N+1).
  const costMap = await getVariantCosts(shopDomain, lines.map((l) => l.variantId));
  let costTotal = 0;
  let costKnown = true;
  for (const l of lines) {
    const c = costMap.get(l.variantId);
    if (!c || c.costPrice == null) costKnown = false;
    else costTotal += c.costPrice * l.quantity;
  }
  if (!costKnown) return { action: "manual", marginAtOffer: 0, reason: "Variant cost unknown." };
  const rules = await activeRuleLites(shopId);
  const rule = pickRule(rules, { variantIds: lines.map((l) => l.variantId), customerGroup: offer.companyId ?? null });
  return evaluateOffer({ listCents: cents(Number(offer.listPriceTotal)), offeredCents: cents(Number(offer.offeredTotal)), costCents: cents(costTotal) }, rule);
}

// --- queue + detail ----------------------------------------------------------

export async function listOffers(shopDomain: string, status?: OfferStatus) {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.offer.findMany({
    where: { shopId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, buyerEmail: true, source: true, status: true, listPriceTotal: true, offeredTotal: true, currentCounterTotal: true, marginAtOffer: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    buyerEmail: r.buyerEmail,
    source: r.source,
    status: r.status,
    listPriceTotal: Number(r.listPriceTotal),
    offeredTotal: Number(r.offeredTotal),
    currentCounterTotal: r.currentCounterTotal == null ? null : Number(r.currentCounterTotal),
    marginAtOffer: r.marginAtOffer == null ? null : Number(r.marginAtOffer),
    createdAt: r.createdAt,
  }));
}

export async function getOffer(shopDomain: string, offerId: string) {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, shopId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return offer;
}

// --- merchant actions (manual) ----------------------------------------------

async function ownedOffer(shopDomain: string, offerId: string): Promise<{ shopId: string; offerId: string } | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const offer = await prisma.offer.findFirst({ where: { id: offerId, shopId }, select: { id: true } });
  return offer ? { shopId, offerId: offer.id } : null;
}

export async function counterOffer(shopDomain: string, offerId: string, counterTotal: number, note?: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedOffer(shopDomain, offerId);
  if (!owned) return { ok: false, error: "Offer not found." };
  if (!(counterTotal > 0)) return { ok: false, error: "Enter a counter amount." };
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      status: "COUNTERED",
      currentCounterTotal: counterTotal,
      handledBy: "MANUAL",
      messages: { create: { actor: "MERCHANT", amountTotal: counterTotal, note: note ?? null } },
    },
  });
  await appendEvent({ shopId: owned.shopId, type: "OFFER_COUNTERED", entityType: "Offer", entityId: offerId, payload: {} });
  return { ok: true };
}

export async function acceptOffer(shopDomain: string, offerId: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedOffer(shopDomain, offerId);
  if (!owned) return { ok: false, error: "Offer not found." };
  await prisma.offer.update({
    where: { id: offerId },
    data: { status: "ACCEPTED", handledBy: "MANUAL", messages: { create: { actor: "MERCHANT", note: "Accepted" } } },
  });
  await appendEvent({ shopId: owned.shopId, type: "OFFER_ACCEPTED", entityType: "Offer", entityId: offerId, payload: {} });
  return { ok: true };
}

export async function declineOffer(shopDomain: string, offerId: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedOffer(shopDomain, offerId);
  if (!owned) return { ok: false, error: "Offer not found." };
  await prisma.offer.update({
    where: { id: offerId },
    data: { status: "DECLINED", handledBy: "MANUAL", messages: { create: { actor: "MERCHANT", note: note ?? "Declined" } } },
  });
  await appendEvent({ shopId: owned.shopId, type: "OFFER_DECLINED", entityType: "Offer", entityId: offerId, payload: {} });
  return { ok: true };
}

// --- conversion: accepted offer → native draft order (PR-4, §2.3) ------------

export interface ConvertResult {
  orderId: string;
  totals: DraftOrderTotals;
}

/**
 * Turn an ACCEPTED offer into a Shopify draft order (the net-terms / deposit
 * path). We split the agreed total across lines as agreed per-unit prices
 * (`agreedUnitPriceCents`) and let Shopify calculate tax + the real total — we
 * never compute money (guardrail #1). Order of operations mirrors S8: call
 * Shopify FIRST, then flip the offer to CONVERTED, so a Shopify failure never
 * strands the offer. The buyer must be linked to a B2B company location (native
 * purchasing entity), exactly like quote → order.
 */
export async function convertOffer(
  shopDomain: string,
  offerId: string,
  admin: AdminGraphqlClient,
  opts: { currencyCode: string; paymentTermsTemplateId?: string | null },
): Promise<ConvertResult | { error: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { error: "Unknown shop." };
  const offer = await prisma.offer.findFirst({ where: { id: offerId, shopId } });
  if (!offer) return { error: "Offer not found." };
  if (offer.status === "CONVERTED") return { error: "This offer is already an order." };
  if (offer.status !== "ACCEPTED") return { error: "Only an accepted offer can be turned into an order." };

  const lines = (offer.lineItems as unknown as OfferLineInput[]) ?? [];
  if (lines.length === 0) return { error: "This offer has no items." };

  // Resolve the native purchasing entity (company + buyer location). Like S8,
  // an order needs a company location — offers from anonymous buyers can't convert.
  if (!offer.companyId) {
    return { error: "Link this buyer to a B2B company before turning the offer into an order." };
  }
  const company = await prisma.company.findFirst({ where: { id: offer.companyId, shopId }, select: { shopifyCompanyId: true } });
  const buyer = await prisma.buyer.findFirst({
    where: { companyId: offer.companyId, email: offer.buyerEmail },
    select: { shopifyContactId: true, shopifyCompanyLocationId: true },
  });
  if (!company || !buyer?.shopifyCompanyLocationId) {
    return { error: "This buyer isn’t linked to a company location yet, so an order can’t be created." };
  }
  const purchasingEntity: PurchasingEntityRef = {
    companyId: company.shopifyCompanyId,
    companyLocationId: buyer.shopifyCompanyLocationId,
    companyContactId: buyer.shopifyContactId,
  };

  // The final agreed total: the buyer accepted either their own offer or the
  // current counter. Split it into agreed per-unit prices; Shopify totals it.
  const listTotalCents = cents(Number(offer.listPriceTotal));
  const agreedTotalCents = cents(offer.currentCounterTotal != null ? Number(offer.currentCounterTotal) : Number(offer.offeredTotal));
  const draftLines: DraftLineInput[] = lines.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    price: (agreedUnitPriceCents(cents(l.listPrice), listTotalCents, agreedTotalCents) / 100).toFixed(2),
  }));

  const input = buildDraftOrderInput({
    currencyCode: opts.currencyCode,
    paymentTermsTemplateId: opts.paymentTermsTemplateId,
    purchasingEntity,
    lines: draftLines,
  });

  // Shopify FIRST (source of truth for money) — then mutate offer state.
  const created = await createDraftOrder(admin, input);

  await prisma.offer.update({
    where: { id: offer.id },
    data: {
      status: "CONVERTED",
      convertedOrderId: created.id,
      messages: { create: { actor: "SYSTEM", amountTotal: agreedTotalCents / 100, note: "Converted to a draft order" } },
    },
  });
  await appendEvent({ shopId, type: "OFFER_CONVERTED", entityType: "Offer", entityId: offer.id, payload: { draftOrderId: created.id } });

  return { orderId: created.id, totals: created.totals };
}

// --- rules -------------------------------------------------------------------

export async function listRules(shopDomain: string) {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.offerRule.findMany({ where: { shopId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({
    id: r.id, name: r.name, scope: r.scope, scopeRef: r.scopeRef,
    minAcceptPctOfList: Number(r.minAcceptPctOfList),
    autoDeclineBelowPctOfList: Number(r.autoDeclineBelowPctOfList),
    autoCounterToPctOfList: r.autoCounterToPctOfList == null ? null : Number(r.autoCounterToPctOfList),
    marginFloorPct: Number(r.marginFloorPct), priority: r.priority, active: r.active,
  }));
}

export interface RuleInput {
  name: string;
  scope?: OfferRuleScope;
  scopeRef?: string | null;
  minAcceptPctOfList: number;
  autoDeclineBelowPctOfList: number;
  autoCounterToPctOfList?: number | null;
  marginFloorPct: number;
  priority?: number;
  active?: boolean;
}

export async function createRule(shopDomain: string, input: RuleInput): Promise<{ id: string } | { error: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { error: "Unknown shop." };
  const caps = await getShopCapabilities(shopDomain);
  const used = await prisma.offerRule.count({ where: { shopId } });
  if (used >= caps.offerRuleCap) throw new OfferRuleCapError(caps.offerRuleCap);
  const rule = await prisma.offerRule.create({
    data: {
      shopId,
      name: input.name.trim() || "Offer rule",
      scope: input.scope ?? "ALL",
      scopeRef: input.scopeRef ?? null,
      minAcceptPctOfList: input.minAcceptPctOfList,
      autoDeclineBelowPctOfList: input.autoDeclineBelowPctOfList,
      autoCounterToPctOfList: input.autoCounterToPctOfList ?? null,
      marginFloorPct: input.marginFloorPct,
      priority: input.priority ?? 0,
      active: input.active ?? true,
    },
    select: { id: true },
  });
  await appendEvent({ shopId, type: "OFFER_RULE_UPDATED", entityType: "OfferRule", entityId: rule.id, payload: { created: true } });
  return { id: rule.id };
}

export async function deleteRule(shopDomain: string, ruleId: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.offerRule.deleteMany({ where: { id: ruleId, shopId } });
  await appendEvent({ shopId, type: "OFFER_RULE_UPDATED", entityType: "OfferRule", entityId: ruleId, payload: { deleted: true } });
}

// --- widget config -----------------------------------------------------------

export async function getWidgetConfig(shopDomain: string) {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  return prisma.offerWidgetConfig.findUnique({ where: { shopId } });
}

export interface WidgetConfigInput {
  surfaces: { button: boolean; banner: boolean; inlineForm: boolean; exitPopup: boolean };
  buttonLabel: string;
  hideAtcUntilOffer: boolean;
}

export async function saveWidgetConfig(shopDomain: string, input: WidgetConfigInput): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  const data = {
    surfaces: input.surfaces as object,
    buttonLabel: input.buttonLabel.trim() || "Make an offer",
    hideAtcUntilOffer: input.hideAtcUntilOffer,
  };
  await prisma.offerWidgetConfig.upsert({ where: { shopId }, create: { shopId, ...data }, update: data });
}

// --- storefront (theme app extension) surfaces (PR-4, §2.3) ------------------

interface OfferSurfaces {
  button: boolean;
  banner: boolean;
  inlineForm: boolean;
  exitPopup: boolean;
}

const DEFAULT_SURFACES: OfferSurfaces = { button: true, banner: false, inlineForm: true, exitPopup: false };

export interface OfferPublicConfig {
  enabled: boolean;
  label: string;
  surfaces: OfferSurfaces;
  hideAtcUntilOffer: boolean;
  /** Scale only: the buyer may get an instant answer (auto-accept/counter/decline). */
  instant: boolean;
}

/**
 * The public config the storefront block reads to decide whether (and how) to
 * render. No secrets, no hidden-catalog data. Off entirely below Growth (teaser)
 * or when the flag is dark. Banner + exit-popup surfaces are Scale-only.
 */
export async function getOfferPublicConfig(shopDomain: string): Promise<OfferPublicConfig> {
  const off: OfferPublicConfig = { enabled: false, label: "Make an offer", surfaces: { ...DEFAULT_SURFACES }, hideAtcUntilOffer: false, instant: false };
  if (!MAKE_AN_OFFER_ENABLED()) return off;
  const caps = await getShopCapabilities(shopDomain);
  if (caps.makeAnOffer === "teaser") return off; // free/starter: no storefront surface
  const isScale = caps.makeAnOffer === "auto";
  const cfg = await getWidgetConfig(shopDomain);
  const s = (cfg?.surfaces as unknown as Partial<OfferSurfaces>) ?? {};
  return {
    enabled: true,
    label: cfg?.buttonLabel ?? "Make an offer",
    surfaces: {
      button: s.button ?? DEFAULT_SURFACES.button,
      inlineForm: s.inlineForm ?? DEFAULT_SURFACES.inlineForm,
      banner: isScale && (s.banner ?? false), // Scale-only surface
      exitPopup: isScale && (s.exitPopup ?? false), // Scale-only surface
    },
    hideAtcUntilOffer: cfg?.hideAtcUntilOffer ?? false,
    instant: isScale,
  };
}

const TOO_FAST_MS = 1200; // a human can't fill the form this fast; a bot can

export interface PublicOfferLine {
  variantId: string;
  title?: string;
  sku?: string;
  quantity: number;
  listPrice: number;
}

export interface PublicOfferInput {
  buyerEmail: string;
  companyId?: string | null;
  source?: OfferSource;
  lines: PublicOfferLine[];
  offeredTotal: number;
  honeypot?: string;
  elapsedMs?: number;
}

export interface PublicOfferResult {
  ok: boolean;
  outcome?: AutoOutcome;
  counterTotal?: number | null;
  error?: string;
  /** True when the submission was silently dropped (spam/rate) — client sees OK. */
  silent?: boolean;
}

/**
 * Storefront entry point for a buyer's offer. Anti-spam mirrors F17 (honeypot +
 * too-fast + rate limit → a generic OK so bots learn nothing). Validates input,
 * then delegates the actual decision to `createOffer` (which enforces the margin
 * floor and, on Scale, auto-executes). The list price is client-supplied but
 * can't force an unsafe accept: the floor check is cost-based and server-side.
 */
export async function submitPublicOffer(
  shopDomain: string,
  input: PublicOfferInput,
  ctx: { rateKey: string; now?: number },
): Promise<PublicOfferResult> {
  const now = ctx.now ?? Date.now();
  // Anti-spam: silent generic OK so bots can't distinguish success from a drop.
  if ((input.honeypot ?? "").trim() !== "") return { ok: true, outcome: "pending", silent: true };
  if (typeof input.elapsedMs === "number" && input.elapsedMs < TOO_FAST_MS) return { ok: true, outcome: "pending", silent: true };
  if (!submitRateOk(`offer:${ctx.rateKey}`, now)) return { ok: true, outcome: "pending", silent: true };

  if (!MAKE_AN_OFFER_ENABLED()) return { ok: false, error: "Offers aren’t available right now." };
  const caps = await getShopCapabilities(shopDomain);
  if (caps.makeAnOffer === "teaser") return { ok: false, error: "Offers aren’t available right now." };

  const email = (input.buyerEmail ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email." };

  const lines = (input.lines ?? []).filter(
    (l) => l && typeof l.variantId === "string" && l.variantId.startsWith("gid://") && l.quantity > 0 && l.listPrice > 0,
  );
  if (lines.length === 0) return { ok: false, error: "Add at least one item." };

  const listTotal = lines.reduce((s, l) => s + l.listPrice * l.quantity, 0);
  const offered = Number(input.offeredTotal);
  if (!(offered > 0)) return { ok: false, error: "Enter your offer." };
  if (offered > listTotal) return { ok: false, error: "Your offer can’t be above the list price." };

  const created = await createOffer(shopDomain, {
    buyerEmail: email,
    companyId: input.companyId ?? null,
    source: input.source ?? "PRODUCT",
    lineItems: lines.map((l) => ({ variantId: l.variantId, title: l.title, sku: l.sku, quantity: l.quantity, listPrice: l.listPrice })),
    offeredTotal: offered,
  });
  if ("error" in created) return { ok: false, error: created.error };

  const counterTotal = created.outcome === "countered" && created.decision.counterCents != null ? created.decision.counterCents / 100 : null;
  return { ok: true, outcome: created.outcome, counterTotal };
}
