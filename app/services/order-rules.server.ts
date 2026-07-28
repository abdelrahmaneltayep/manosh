import type { RuleScope } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import {
  evaluateCart,
  type OrderRuleLite,
  type CartEvaluation,
} from "../lib/order-rules";
import { allowedRuleScopes, packRulesAllowed } from "../lib/billing";

/**
 * F9 — order-rule persistence + the single enforcement entrypoint used by the
 * portal cart, the F4 order pad, and quote→order conversion. The MATH lives in
 * the pure app/lib/order-rules.ts; this module fetches, persists, and logs.
 */

export class RuleScopeNotAllowedError extends Error {
  constructor() {
    super("That rule scope isn't available on your plan.");
    this.name = "RuleScopeNotAllowedError";
  }
}
export class NotFoundError extends Error {
  constructor() {
    super("Not found.");
    this.name = "OrderRuleNotFoundError";
  }
}

async function shopFor(shopDomain: string) {
  return prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true, plan: true } });
}

/** All rules for a shop as the pure resolver's shape. */
export async function getRulesForShop(shopDomain: string): Promise<OrderRuleLite[]> {
  const rows = await prisma.orderRule.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    orderBy: [{ priority: "desc" }],
  });
  return rows.map(toLite);
}

function toLite(r: {
  scope: RuleScope;
  targetId: string | null;
  minQty: number | null;
  packSize: number | null;
  minOrderValue: unknown;
  priority: number;
}): OrderRuleLite {
  return {
    scope: r.scope,
    targetId: r.targetId,
    minQty: r.minQty,
    packSize: r.packSize,
    minOrderValue: r.minOrderValue == null ? null : Number(r.minOrderValue),
    priority: r.priority,
  };
}

export async function listRules(shopDomain: string) {
  const rows = await prisma.orderRule.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    orderBy: [{ scope: "asc" }, { priority: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    targetId: r.targetId,
    minQty: r.minQty,
    packSize: r.packSize,
    minOrderValue: r.minOrderValue == null ? null : r.minOrderValue.toString(),
    priority: r.priority,
  }));
}

export interface RuleInput {
  scope: RuleScope;
  targetId: string | null;
  minQty: number | null;
  packSize: number | null;
  minOrderValue: number | null;
  priority: number;
}

function assertAllowed(plan: string | null | undefined, input: RuleInput) {
  if (!allowedRuleScopes(plan).includes(input.scope)) throw new RuleScopeNotAllowedError();
  if (input.packSize != null && !packRulesAllowed(plan)) throw new RuleScopeNotAllowedError();
}

export async function createRule(shopDomain: string, input: RuleInput): Promise<{ id: string }> {
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError();
  assertAllowed(shop.plan, input);
  const created = await prisma.orderRule.create({
    data: {
      shopId: shop.id,
      scope: input.scope,
      targetId: input.targetId,
      minQty: input.minQty,
      packSize: input.packSize,
      minOrderValue: input.minOrderValue == null ? null : input.minOrderValue.toFixed(4),
      priority: input.priority,
    },
    select: { id: true },
  });
  return created;
}

export async function deleteRule(shopDomain: string, ruleId: string): Promise<void> {
  await prisma.orderRule.deleteMany({ where: { id: ruleId, shop: { shopifyDomain: shopDomain } } });
}

// --- CSV (pure parse) --------------------------------------------------------

export const RULES_CSV_TEMPLATE = "scope,target_id,min_qty,pack_size,min_order_value,priority\n";

export interface RulesCsvResult {
  rows: RuleInput[];
  errors: string[];
}

const SCOPES: RuleScope[] = ["STORE", "COLLECTION", "PRODUCT", "CUSTOMER_GROUP"];

/** Parse a rules CSV. Pure. Header optional. */
export function parseRulesCsv(text: string): RulesCsvResult {
  const rows: RuleInput[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows, errors: ["The file is empty."] };
  let start = 0;
  if (/scope/i.test(lines[0])) start = 1;

  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const [scopeRaw, targetId, minQty, packSize, minValue, priority] = cols;
    const scope = scopeRaw?.toUpperCase() as RuleScope;
    const lineNo = i + 1;
    if (!SCOPES.includes(scope)) {
      errors.push(`Line ${lineNo}: unknown scope "${scopeRaw}".`);
      continue;
    }
    const num = (v: string | undefined) => (v && v !== "" ? Number(v) : null);
    rows.push({
      scope,
      targetId: targetId || null,
      minQty: num(minQty),
      packSize: num(packSize),
      minOrderValue: num(minValue),
      priority: Number(priority) || 0,
    });
  }
  return { rows, errors };
}

export async function importRulesCsv(shopDomain: string, rows: RuleInput[]): Promise<number> {
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError();
  let n = 0;
  for (const r of rows) {
    try {
      assertAllowed(shop.plan, r);
      await createRule(shopDomain, r);
      n++;
    } catch {
      /* skip a disallowed row */
    }
  }
  return n;
}

// --- enforcement (shared by all three call sites) ----------------------------

export interface EvalLine {
  variantId: string;
  qty: number;
  price: number;
}

/**
 * Evaluate a cart against the shop's rules for a company. This is the ONE place
 * the three surfaces (portal cart, order pad, quote conversion) call, so MOQ /
 * pack / min-value behave identically everywhere.
 */
export async function evaluateForCompany(
  shopDomain: string,
  lines: EvalLine[],
  companyId: string | null,
): Promise<CartEvaluation> {
  const rules = await getRulesForShop(shopDomain);
  return evaluateCart(lines, rules, { companyId });
}

/** Record that a rule adjusted an order (append-only, ids + numbers only). */
export async function logRuleApplied(
  shopId: string,
  entityId: string,
  payload: { changed: number; blocked: boolean },
): Promise<void> {
  await appendEvent({ shopId, type: "ORDER_RULE_APPLIED", entityType: "Quote", entityId, payload });
}
