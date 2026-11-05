// F24.2 — storefront price / Add-to-Cart visibility (pure, client-safe). The
// merchant defines rules; the theme app extension asks for a decision and hides
// price / ATC + shows a "Request a Quote" CTA accordingly.
//
// THE INVARIANT: a decision NEVER contains a price. This module only ever emits
// booleans + a CTA label, so a hidden price can't leak through our markup/JSON
// (§5.2). Enforced by the `VisibilityDecision` type and covered by tests.

import { effectivePlanHandle, meetsPlan } from "./billing-v3";
export type PriceScope = "ALL" | "LOGGED_OUT" | "CUSTOMER_TAG" | "PRODUCT" | "COLLECTION";

export interface PriceRuleLite {
  id: string;
  scope: PriceScope;
  scopeRef: string | null;
  hidePrice: boolean;
  hideAtc: boolean;
  ctaLabel: string;
  active: boolean;
  priority: number;
}

export interface StorefrontContext {
  loggedIn: boolean;
  customerTags?: string[];
  productId?: string | null;
  collectionIds?: string[];
}

/** The storefront decision. Booleans + a label ONLY — never a price. */
export interface VisibilityDecision {
  hidePrice: boolean;
  hideAtc: boolean;
  ctaLabel: string | null;
}

/** The default (nothing hidden) decision. Pure. */
export const SHOW_ALL: VisibilityDecision = { hidePrice: false, hideAtc: false, ctaLabel: null };

const SPECIFICITY: Record<PriceScope, number> = {
  PRODUCT: 5,
  COLLECTION: 4,
  CUSTOMER_TAG: 3,
  LOGGED_OUT: 2,
  ALL: 1,
};

/** Case-insensitive tag membership. Pure. */
function hasTag(tags: string[] | undefined, ref: string | null): boolean {
  if (!ref) return false;
  const needle = ref.trim().toLowerCase();
  return (tags ?? []).some((t) => t.trim().toLowerCase() === needle);
}

/** Does a rule apply to this storefront context? Pure. */
export function ruleMatches(rule: PriceRuleLite, ctx: StorefrontContext): boolean {
  if (!rule.active) return false;
  switch (rule.scope) {
    case "ALL":
      return true;
    case "LOGGED_OUT":
      return !ctx.loggedIn;
    case "CUSTOMER_TAG":
      return hasTag(ctx.customerTags, rule.scopeRef);
    case "PRODUCT":
      return !!rule.scopeRef && ctx.productId === rule.scopeRef;
    case "COLLECTION":
      return !!rule.scopeRef && (ctx.collectionIds ?? []).includes(rule.scopeRef);
  }
}

/** The highest-priority matching rule (ties broken by specificity, then id). Pure. */
export function pickPriceRule(rules: PriceRuleLite[], ctx: StorefrontContext): PriceRuleLite | null {
  const matched = rules.filter((r) => ruleMatches(r, ctx));
  if (matched.length === 0) return null;
  matched.sort(
    (a, b) =>
      b.priority - a.priority ||
      SPECIFICITY[b.scope] - SPECIFICITY[a.scope] ||
      a.id.localeCompare(b.id),
  );
  return matched[0];
}

/**
 * Decide what the storefront should hide for this visitor. Returns SHOW_ALL when
 * no rule matches. The result carries no price — only the hide flags + CTA label.
 * Pure.
 */
export function evaluateVisibility(rules: PriceRuleLite[], ctx: StorefrontContext): VisibilityDecision {
  const rule = pickPriceRule(rules, ctx);
  if (!rule) return { ...SHOW_ALL };
  // If neither price nor ATC is hidden, there's nothing to swap in.
  if (!rule.hidePrice && !rule.hideAtc) return { ...SHOW_ALL };
  return {
    hidePrice: rule.hidePrice,
    hideAtc: rule.hideAtc,
    ctaLabel: rule.ctaLabel?.trim() || "Request a Quote",
  };
}

/**
 * Plan gate for a scope (pure). Broad audience scopes (ALL, LOGGED_OUT) need
 * Starter or above; targeted scopes (customer tag / product / collection) need
 * Growth or above. Reads the v3 ladder (billing-v3) so Scale, and a trial
 * (which grants Starter-level access), are covered; legacy "Starter"/"Growth"
 * subscription names still work. Free and cancelled shops get no rules.
 */
export function priceRuleScopeAllowed(plan: string | null | undefined, scope: PriceScope, legacy = false): boolean {
  if (!plan) return false;
  const handle = effectivePlanHandle(String(plan).toUpperCase(), legacy);
  if (scope === "ALL" || scope === "LOGGED_OUT") return meetsPlan(handle, "starter");
  return meetsPlan(handle, "growth"); // CUSTOMER_TAG / PRODUCT / COLLECTION
}
