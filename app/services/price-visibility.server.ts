import type { PriceVisibilityScope } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import {
  evaluateVisibility,
  priceRuleScopeAllowed,
  SHOW_ALL,
  type PriceRuleLite,
  type PriceScope,
  type StorefrontContext,
  type VisibilityDecision,
} from "../lib/price-visibility";

/**
 * F24.2 — storefront price / ATC visibility service. The merchant defines rules
 * in embedded Polaris; the theme app extension asks for a decision. Broad scopes
 * (all / logged-out) are Starter; targeted scopes (tag / product / collection)
 * are Growth (`priceRuleScopeAllowed`) — enforced here and in the UI. Behind
 * MANNON_FF_QUOTE_CAPTURE. Emits PRICE_RULE_UPDATED.
 *
 * INVARIANT: nothing here ever returns a price — only the hide flags + CTA label
 * — so a hidden price can't leak through our API/markup (§5.2).
 */

export const QUOTE_CAPTURE_ENABLED = () => process.env.MANNON_FF_QUOTE_CAPTURE === "true";

export class ScopeNotAllowedError extends Error {
  constructor(public scope: PriceScope) {
    super("This rule scope needs a higher plan.");
    this.name = "ScopeNotAllowedError";
  }
}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}
async function planFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { plan: true } });
  return shop?.plan ?? null;
}

export interface PriceRuleRow {
  id: string;
  scope: PriceScope;
  scopeRef: string | null;
  hidePrice: boolean;
  hideAtc: boolean;
  ctaLabel: string;
  active: boolean;
  priority: number;
}

function toRow(r: {
  id: string; scope: PriceVisibilityScope; scopeRef: string | null;
  hidePrice: boolean; hideAtc: boolean; ctaLabel: string; active: boolean; priority: number;
}): PriceRuleRow {
  return { id: r.id, scope: r.scope as PriceScope, scopeRef: r.scopeRef, hidePrice: r.hidePrice, hideAtc: r.hideAtc, ctaLabel: r.ctaLabel, active: r.active, priority: r.priority };
}

export async function listPriceRules(shopDomain: string): Promise<PriceRuleRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.priceVisibilityRule.findMany({ where: { shopId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  return rows.map(toRow);
}

export interface PriceRuleInput {
  id?: string | null;
  scope: PriceScope;
  scopeRef?: string | null;
  hidePrice: boolean;
  hideAtc: boolean;
  ctaLabel?: string;
  priority?: number;
  active?: boolean;
}

/** Create/update a rule. Enforces the plan gate on the scope. Emits PRICE_RULE_UPDATED. */
export async function savePriceRule(shopDomain: string, input: PriceRuleInput): Promise<{ id: string } | { error: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { error: "Unknown shop." };
  const plan = await planFor(shopDomain);
  if (!priceRuleScopeAllowed(plan, input.scope)) throw new ScopeNotAllowedError(input.scope);

  // Targeted scopes need a reference; broad ones must not carry one.
  const needsRef = input.scope === "CUSTOMER_TAG" || input.scope === "PRODUCT" || input.scope === "COLLECTION";
  const scopeRef = needsRef ? (input.scopeRef?.trim() || null) : null;
  if (needsRef && !scopeRef) return { error: "This scope needs a tag, product, or collection reference." };

  const data = {
    scope: input.scope as PriceVisibilityScope,
    scopeRef,
    hidePrice: input.hidePrice,
    hideAtc: input.hideAtc,
    ctaLabel: input.ctaLabel?.trim() || "Request a Quote",
    priority: input.priority ?? 0,
    active: input.active ?? true,
  };

  if (input.id) {
    const existing = await prisma.priceVisibilityRule.findFirst({ where: { id: input.id, shopId }, select: { id: true } });
    if (!existing) return { error: "Rule not found." };
    await prisma.priceVisibilityRule.update({ where: { id: input.id }, data });
    await appendEvent({ shopId, type: "PRICE_RULE_UPDATED", entityType: "PriceVisibilityRule", entityId: input.id, payload: { scope: input.scope } });
    return { id: input.id };
  }
  const created = await prisma.priceVisibilityRule.create({ data: { shopId, ...data }, select: { id: true } });
  await appendEvent({ shopId, type: "PRICE_RULE_UPDATED", entityType: "PriceVisibilityRule", entityId: created.id, payload: { created: true, scope: input.scope } });
  return { id: created.id };
}

export async function deletePriceRule(shopDomain: string, id: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.priceVisibilityRule.deleteMany({ where: { id, shopId } });
  await appendEvent({ shopId, type: "PRICE_RULE_UPDATED", entityType: "PriceVisibilityRule", entityId: id, payload: { deleted: true } });
}

/** Active rules as the pure-engine lite shape (for evaluation). */
async function activeRuleLites(shopId: string): Promise<PriceRuleLite[]> {
  const rows = await prisma.priceVisibilityRule.findMany({ where: { shopId, active: true }, orderBy: { priority: "desc" } });
  return rows.map((r) => ({ id: r.id, scope: r.scope as PriceScope, scopeRef: r.scopeRef, hidePrice: r.hidePrice, hideAtc: r.hideAtc, ctaLabel: r.ctaLabel, active: r.active, priority: r.priority }));
}

/**
 * The storefront decision for a visitor+context. Returns SHOW_ALL when the
 * feature is off or nothing matches. NEVER returns a price (§5.2 invariant).
 */
export async function evaluatePriceVisibility(shopDomain: string, ctx: StorefrontContext): Promise<VisibilityDecision> {
  if (!QUOTE_CAPTURE_ENABLED()) return { ...SHOW_ALL };
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { ...SHOW_ALL };
  const rules = await activeRuleLites(shopId);
  return evaluateVisibility(rules, ctx);
}
