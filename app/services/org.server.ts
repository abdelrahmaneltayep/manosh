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

export async function linkStore(
  orgId: string,
  actingRole: OrgRole,
  shopDomain: string,
  role: OrgRole,
  baseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canManage(actingRole)) return { ok: false, error: "You don’t have permission to link stores." };
  const domain = shopDomain.trim().toLowerCase();
  if (!domain) return { ok: false, error: "Enter a store domain." };

  // Entitlement: each managed store needs its own Growth subscription.
  const shop = await shopBy(domain);
  if (!shop) return { ok: false, error: "That store hasn’t installed Mannon yet." };
  if (!agencyAllowed(shop.plan)) return { ok: false, error: "That store needs its own Growth plan before it can be linked." };

  const existing = await prisma.orgStore.findUnique({ where: { shop: domain } });
  if (existing) {
    return { ok: false, error: existing.orgId === orgId ? "That store is already in this organization." : "That store belongs to another organization." };
  }

  await prisma.orgStore.create({ data: { orgId, shop: domain, role } });
  await appendEvent({ shopId: shop.id, type: "STORE_LINKED", entityType: "OrgStore", entityId: domain, payload: { role } });

  // Store-linked confirmation (best-effort, white-label-aware wording).
  try {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, ownerEmail: true } });
    if (org) {
      const tokens = await getBrandingTokens(domain);
      const tpl = resolveTemplate("store_linked", null);
      const { subject, body } = renderTemplate(tpl, { orgName: org.name, storeDomain: domain, portalName: tokens.portalName, appUrl: `${baseUrl.replace(/\/$/, "")}/app/agency` });
      await sendEmail({ to: org.ownerEmail, subject, html: body.replace(/\n/g, "<br>"), text: body });
    }
  } catch {
    /* best-effort */
  }
  return { ok: true };
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
