import type { CreditProfile } from "@prisma/client";
import prisma from "../db.server";

/**
 * F2 — credit profiles + the credit check. The check itself is a pure function
 * (unit-tested); the DB helpers around it are thin. Growth-gating is enforced at
 * the route/action layer with requirePlan; a profile row is harmless on any plan.
 */

export const TERM_OPTIONS = [7, 15, 30, 45, 60, 90] as const;
export type TermDays = (typeof TERM_OPTIONS)[number];

export type CreditDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "on-hold" }
  | { allowed: false; reason: "over-limit"; outstanding: number; limit: number; projected: number };

export interface CreditCheckInput {
  status: "ACTIVE" | "HOLD";
  /** 0 (or ≤0) means no limit is enforced. */
  creditLimit: number;
  outstanding: number;
  newOrderAmount: number;
}

/**
 * Pure credit decision. A company on HOLD is always blocked. Otherwise, when a
 * positive limit is set, block if outstanding + new order would exceed it. A
 * zero/absent limit means "no limit enforced" → always allowed.
 */
export function evaluateCredit(input: CreditCheckInput): CreditDecision {
  if (input.status === "HOLD") return { allowed: false, reason: "on-hold" };
  const limit = input.creditLimit;
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true, reason: "ok" };
  const projected = input.outstanding + input.newOrderAmount;
  if (projected > limit) {
    return { allowed: false, reason: "over-limit", outstanding: input.outstanding, limit, projected };
  }
  return { allowed: true, reason: "ok" };
}

/** Plain-language reason for a blocked order (merchant-facing). */
export function creditBlockMessage(decision: CreditDecision): string | null {
  if (decision.allowed) return null;
  if (decision.reason === "on-hold") {
    return "This company is on credit hold. Take it off hold to place orders on terms.";
  }
  return `This order would put the company over its credit limit (${decision.projected.toFixed(2)} of ${decision.limit.toFixed(2)}). Override with a reason or raise the limit.`;
}

/** Sum of OPEN + OVERDUE invoice amounts for a company. */
export async function outstandingForCompany(companyId: string): Promise<number> {
  const rows = await prisma.invoice.findMany({
    where: { companyId, status: { in: ["OPEN", "OVERDUE"] } },
    select: { amount: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}

export async function getCreditProfile(companyId: string): Promise<CreditProfile | null> {
  return prisma.creditProfile.findUnique({ where: { companyId } });
}

export interface CompanyCreditRow {
  id: string;
  name: string;
  creditLimit: number;
  termsDays: number;
  status: "ACTIVE" | "HOLD" | null; // null = no profile yet
}

/** All companies for the shop with their credit profile (if any). */
export async function listCompaniesWithCredit(shopDomain: string): Promise<CompanyCreditRow[]> {
  const companies = await prisma.company.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    include: { creditProfile: true },
    orderBy: { name: "asc" },
  });
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    creditLimit: c.creditProfile ? Number(c.creditProfile.creditLimit) : 0,
    termsDays: c.creditProfile?.termsDays ?? 30,
    status: c.creditProfile?.status ?? null,
  }));
}

/** Confirm a company belongs to the shop (ownership guard for credit actions). */
export async function companyBelongsToShop(companyId: string, shopDomain: string): Promise<boolean> {
  const found = await prisma.company.findFirst({
    where: { id: companyId, shop: { shopifyDomain: shopDomain } },
    select: { id: true },
  });
  return found !== null;
}

export interface CreditProfileInput {
  creditLimit: number;
  termsDays: number;
  status: "ACTIVE" | "HOLD";
}

/** Pure validation for the credit-profile form. */
export function validateCreditProfile(input: {
  creditLimit: number;
  termsDays: number;
  status: string;
}): { ok: true; value: CreditProfileInput } | { ok: false; error: string } {
  if (!Number.isFinite(input.creditLimit) || input.creditLimit < 0) {
    return { ok: false, error: "Credit limit must be zero or more (0 means no limit)." };
  }
  if (!TERM_OPTIONS.includes(input.termsDays as TermDays)) {
    return { ok: false, error: "Choose a term of 7, 15, 30, 45, 60, or 90 days." };
  }
  if (input.status !== "ACTIVE" && input.status !== "HOLD") {
    return { ok: false, error: "Status must be active or hold." };
  }
  return { ok: true, value: { creditLimit: input.creditLimit, termsDays: input.termsDays, status: input.status } };
}

export async function upsertCreditProfile(
  companyId: string,
  input: CreditProfileInput,
): Promise<CreditProfile> {
  return prisma.creditProfile.upsert({
    where: { companyId },
    create: {
      companyId,
      creditLimit: input.creditLimit.toFixed(4),
      termsDays: input.termsDays,
      status: input.status,
    },
    update: {
      creditLimit: input.creditLimit.toFixed(4),
      termsDays: input.termsDays,
      status: input.status,
    },
  });
}
