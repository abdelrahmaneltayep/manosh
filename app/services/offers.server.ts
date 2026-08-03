import type { OfferSource, OfferStatus, OfferRuleScope } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { getVariantCost } from "./variant-cost.server";
import { getShopCapabilities } from "./billing.server";
import {
  evaluateOffer,
  pickRule,
  type OfferRuleLite,
  type OfferDecision,
} from "../lib/offers";

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
  decision: OfferDecision; // the SUGGESTION — auto-execution is PR-4
  costKnown: boolean;
}

/**
 * Create an offer, evaluate it against the shop's rules, and record it PENDING.
 * The evaluation is a *suggestion* surfaced to the merchant; PR-4 wires the scale
 * auto-execution. When any line's cost is unknown, we can't verify margin, so the
 * suggestion is forced to manual (never auto-commit blind).
 */
export async function createOffer(shopDomain: string, input: CreateOfferInput): Promise<CreatedOffer | { error: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { error: "Unknown shop." };
  if (input.lineItems.length === 0) return { error: "No items on the offer." };

  const listTotal = input.lineItems.reduce((s, l) => s + l.listPrice * l.quantity, 0);
  let costTotal = 0;
  let costKnown = true;
  for (const l of input.lineItems) {
    const c = await getVariantCost(shopDomain, l.variantId);
    if (c.costPrice == null) costKnown = false;
    else costTotal += c.costPrice * l.quantity;
  }

  const rules = await activeRuleLites(shopId);
  const rule = pickRule(rules, { variantIds: input.lineItems.map((l) => l.variantId), customerGroup: input.companyId ?? null });

  const decision: OfferDecision = costKnown
    ? evaluateOffer({ listCents: cents(listTotal), offeredCents: cents(input.offeredTotal), costCents: cents(costTotal) }, rule)
    : { action: "manual", marginAtOffer: 0, reason: "Variant cost unknown — set costs to enable margin-safe automation." };

  const offer = await prisma.offer.create({
    data: {
      shopId,
      buyerEmail: input.buyerEmail.trim().toLowerCase(),
      companyId: input.companyId ?? null,
      source: input.source ?? "PRODUCT",
      status: "PENDING",
      lineItems: input.lineItems as object,
      listPriceTotal: listTotal,
      offeredTotal: input.offeredTotal,
      marginAtOffer: costKnown ? decision.marginAtOffer : null,
      ruleId: rule?.id ?? null,
      messages: { create: { actor: "BUYER", amountTotal: input.offeredTotal, note: "Buyer's offer" } },
    },
    select: { id: true },
  });

  await appendEvent({ shopId, type: "OFFER_CREATED", entityType: "Offer", entityId: offer.id, payload: { suggested: decision.action } });
  return { offerId: offer.id, decision, costKnown };
}

/** Recompute the engine's suggestion for an existing offer (for the admin display). */
export async function offerSuggestion(shopDomain: string, offerId: string): Promise<OfferDecision | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const offer = await prisma.offer.findFirst({ where: { id: offerId, shopId } });
  if (!offer) return null;
  const lines = (offer.lineItems as unknown as OfferLineInput[]) ?? [];
  let costTotal = 0;
  let costKnown = true;
  for (const l of lines) {
    const c = await getVariantCost(shopDomain, l.variantId);
    if (c.costPrice == null) costKnown = false;
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
