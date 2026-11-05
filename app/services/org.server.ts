import { createHash, randomBytes } from "node:crypto";
import type { OrgRole } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { getBrandingTokens } from "./branding.server";
import { getDashboardMetrics, addDecimal, type RevenueTotal } from "./dashboard.server";
import { agencyAllowed } from "../lib/billing";
import { canManage, storeHandle, storeAdminUrl } from "../lib/org";

// Re-exported for existing server-side callers; the pure defs live in lib/org.
export { canManage, storeHandle, storeAdminUrl };

/**
 * F20 — agency multi-store management. An Organization groups several Mannon
 * stores for cross-store rollups (reusing F7/dashboard metrics) and role-based
 * navigation. Strict per-store isolation: every metric query is keyed by that
 * store's shopId — data never crosses stores. Management-only: each store still
 * bills separately through Shopify. Growth-only (Agency add-on).
 */

export const WHITE_LABEL_ENABLED = () => process.env.MANNON_FF_WHITE_LABEL === "true";

export class NotAllowedError extends Error {}
export class NotFoundError extends Error {}

async function shopBy(shopDomain: string) {
  return prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true, plan: true } });
}

// --- org lifecycle -----------------------------------------------------------

export async function getOrgForShop(shopDomain: string): Promise<{ orgId: string; name: string; ownerEmail: string; myRole: OrgRole } | null> {
  const membership = await prisma.orgStore.findUnique({
    where: { shop: shopDomain },
    include: { org: { select: { id: true, name: true, ownerEmail: true } } },
  });
  if (!membership) return null;
  return { orgId: membership.org.id, name: membership.org.name, ownerEmail: membership.org.ownerEmail, myRole: membership.role };
}

export async function createOrganization(
  name: string,
  ownerEmail: string,
  firstShopDomain: string,
  plan: string | null,
): Promise<{ orgId: string } | { error: string }> {
  if (!agencyAllowed(plan)) throw new NotAllowedError("Agency mode is a Growth feature.");
  const shop = await shopBy(firstShopDomain);
  if (!shop) return { error: "Unknown shop." };

  const existing = await prisma.orgStore.findUnique({ where: { shop: firstShopDomain } });
  if (existing) return { error: "This store is already part of an organization." };

  const org = await prisma.organization.create({
    data: {
      name: name.trim() || "Agency",
      ownerEmail: ownerEmail.trim().toLowerCase(),
      stores: { create: { shop: firstShopDomain, role: "OWNER" } },
    },
    select: { id: true },
  });

  await appendEvent({ shopId: shop.id, type: "ORG_CREATED", entityType: "Organization", entityId: org.id, payload: {} });

  // Org-invite email to the owner (best-effort, respects white-label wording).
  try {
    const tokens = await getBrandingTokens(firstShopDomain);
    const tpl = resolveTemplate("org_invite", null);
    const { subject, body } = renderTemplate(tpl, { orgName: name, portalName: tokens.portalName, shopName: firstShopDomain });
    await sendEmail({ to: ownerEmail, subject, html: body.replace(/\n/g, "<br>"), text: body });
  } catch {
    /* best-effort */
  }

  return { orgId: org.id };
}

// --- store linking -----------------------------------------------------------

/** Days an invite code stays valid. Documented in docs/compliance.md (agency linking). */
export const ORG_INVITE_TTL_DAYS = 7;

/** A readable single-use code, e.g. "MNN-7KQ2-XW9D-4TPA" (no 0/O/1/I). Pure apart from randomness. */
export function generateInviteCode(random: (n: number) => Buffer = randomBytes): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = random(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `MNN-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Normalize what a merchant typed (spaces, case, missing dashes) before hashing. Pure. */
export function normalizeInviteCode(input: string): string {
  const raw = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^MNN/, "");
  return raw.length === 12 ? `MNN-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}` : "";
}

export const hashInviteCode = (code: string): string => createHash("sha256").update(code).digest("hex");

/**
 * Create a single-use code that lets a client store join this organization.
 * The client store's own merchant redeems it inside their Mannon, so a store is
 * only ever linked with its consent, and nobody types a store domain (App Store
 * 2.3.1). Only the hash is stored; the raw code is shown once.
 */
export async function createStoreInvite(
  orgId: string,
  actingRole: OrgRole,
  role: OrgRole,
  now: Date = new Date(),
): Promise<{ ok: true; code: string; expiresAt: Date } | { ok: false; error: string }> {
  if (!canManage(actingRole)) return { ok: false, error: "You don’t have permission to invite stores." };
  const safeRole: OrgRole = role === "VIEWER" ? "VIEWER" : "MANAGER"; // an invite never grants OWNER
  const code = generateInviteCode();
  const expiresAt = new Date(now.getTime() + ORG_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.orgInvite.create({ data: { orgId, codeHash: hashInviteCode(code), role: safeRole, expiresAt } });
  return { ok: true, code, expiresAt };
}

/**
 * Redeem an invite code for the store the merchant is signed in to. The
 * joining store is always the authenticated session's shop.
 */
export async function joinWithInvite(
  shopDomain: string,
  codeInput: string,
  baseUrl: string,
  now: Date = new Date(),
): Promise<{ ok: true; orgName: string } | { ok: false; error: string }> {
  const code = normalizeInviteCode(codeInput);
  if (!code) return { ok: false, error: "Enter the invite code exactly as you received it, e.g. MNN-7KQ2-XW9D-4TPA." };

  const shop = await shopBy(shopDomain);
  if (!shop) return { ok: false, error: "Unknown shop." };
  if (!agencyAllowed(shop.plan)) return { ok: false, error: "This store needs its own Growth plan before it can join an organization." };
  if (await prisma.orgStore.findUnique({ where: { shop: shopDomain } })) return { ok: false, error: "This store is already part of an organization." };

  const invite = await prisma.orgInvite.findUnique({ where: { codeHash: hashInviteCode(code) }, include: { org: { select: { id: true, name: true, ownerEmail: true } } } });
  if (!invite || invite.usedAt || invite.expiresAt <= now) {
    return { ok: false, error: "That invite code isn’t valid. It may have been used already or expired; ask the organization for a new one." };
  }

  // Claim the invite first (single use, race-safe), then link.
  const claimed = await prisma.orgInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: now, usedByShop: shopDomain } });
  if (claimed.count !== 1) return { ok: false, error: "That invite code has just been used. Ask the organization for a new one." };
  await prisma.orgStore.create({ data: { orgId: invite.orgId, shop: shopDomain, role: invite.role } });
  await appendEvent({ shopId: shop.id, type: "STORE_LINKED", entityType: "OrgStore", entityId: shopDomain, payload: { role: invite.role, via: "invite" } });

  // Store-linked confirmation to the organization owner (best-effort, white-label-aware wording).
  try {
    const tokens = await getBrandingTokens(shopDomain);
    const tpl = resolveTemplate("store_linked", null);
    const { subject, body } = renderTemplate(tpl, { orgName: invite.org.name, storeDomain: shopDomain, portalName: tokens.portalName, appUrl: `${baseUrl.replace(/\/$/, "")}/app/agency` });
    await sendEmail({ to: invite.org.ownerEmail, subject, html: body.replace(/\n/g, "<br>"), text: body });
  } catch {
    /* best-effort */
  }
  return { ok: true, orgName: invite.org.name };
}

export async function unlinkStore(orgId: string, actingRole: OrgRole, shopDomain: string): Promise<{ ok: boolean; error?: string }> {
  if (!canManage(actingRole)) return { ok: false, error: "You don’t have permission." };
  // Don't allow removing the last OWNER-less org via unlinking the owner store here;
  // keep it simple — deleting the org is a separate action.
  await prisma.orgStore.deleteMany({ where: { orgId, shop: shopDomain, role: { not: "OWNER" } } });
  return { ok: true };
}

// --- cross-store rollup (reuses F7/dashboard metrics, per-store isolated) -----

export interface StoreRollup {
  shop: string;
  role: OrgRole;
  installed: boolean;
  adminUrl: string;
  quotesSent: number;
  quotesAccepted: number;
  orders: number;
  revenue: RevenueTotal[];
}

export interface OrgRollup {
  name: string;
  stores: StoreRollup[];
  totals: { quotesSent: number; quotesAccepted: number; orders: number; revenue: RevenueTotal[] };
}

function mergeRevenue(into: Map<string, string>, revenue: RevenueTotal[]): void {
  for (const r of revenue) {
    into.set(r.currencyCode, addDecimal(into.get(r.currencyCode) ?? "0", r.amount));
  }
}

export async function getOrgRollup(orgId: string): Promise<OrgRollup | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { stores: { orderBy: { createdAt: "asc" } } },
  });
  if (!org) return null;

  const stores: StoreRollup[] = [];
  const totalsRevenue = new Map<string, string>();
  let tQuotes = 0;
  let tAccepted = 0;
  let tOrders = 0;

  for (const s of org.stores) {
    const shop = await shopBy(s.shop);
    if (!shop) {
      stores.push({ shop: s.shop, role: s.role, installed: false, adminUrl: storeAdminUrl(s.shop), quotesSent: 0, quotesAccepted: 0, orders: 0, revenue: [] });
      continue;
    }
    // Per-store isolation: metrics are scoped strictly to this store's shopId.
    const m = await getDashboardMetrics(shop.id);
    stores.push({
      shop: s.shop,
      role: s.role,
      installed: true,
      adminUrl: storeAdminUrl(s.shop),
      quotesSent: m.quotesSent,
      quotesAccepted: m.quotesAccepted,
      orders: m.ordersCount,
      revenue: m.revenue,
    });
    tQuotes += m.quotesSent;
    tAccepted += m.quotesAccepted;
    tOrders += m.ordersCount;
    mergeRevenue(totalsRevenue, m.revenue);
  }

  const revenue: RevenueTotal[] = Array.from(totalsRevenue.entries())
    .map(([currencyCode, amount]) => ({ currencyCode, amount }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  return { name: org.name, stores, totals: { quotesSent: tQuotes, quotesAccepted: tAccepted, orders: tOrders, revenue } };
}
