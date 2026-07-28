import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { getCatalog, type CatalogItem } from "./catalog.server";
import { assignCatalog } from "./catalogs.server";
import { provisionApproval, submitRateOk } from "./wholesale.server";
import { getRulesForShop } from "./order-rules.server";
import { buildVisibility, filterVisible } from "../lib/catalog-visibility";
import { matchingRules } from "../lib/order-rules";
import { catalogSharingAllowed } from "../lib/billing";
import {
  validateLead,
  slugify,
  uniqueSlug,
  pricesVisibleOnPublicPage,
  priceNotice,
  buildPublicMeta,
  isHoneypotTripped,
  type ShowPrices,
} from "../lib/public-catalog";

/**
 * F19 — Catalog Sharing & B2B Discovery. Publish a chosen F11 Catalog as a
 * branded public wholesale page (link or listed in the discovery index). A
 * "Request wholesale access" CTA creates a CatalogLead; approving it runs the
 * F6 provisioning pipeline (Company + magic-link buyer) and assigns the catalog
 * (F11) so the new buyer sees real prices. Growth-only; dark-launched behind
 * MANNON_FF_CATALOG_SHARE.
 *
 * Price-protection guarantee: the public page reads products through the SAME
 * F11 visibility resolution as the portal, so a hidden SKU can never leak, and
 * prices only render when the merchant explicitly chose showPrices = PUBLIC.
 */

export const CATALOG_SHARE_ENABLED = () => process.env.MANNON_FF_CATALOG_SHARE === "true";

export class NotFoundError extends Error {}
export class NotAllowedError extends Error {}

async function shopFor(shopDomain: string) {
  return prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, emailTemplates: true },
  });
}

// --- merchant CRUD -----------------------------------------------------------

export interface PublicCatalogRow {
  id: string;
  slug: string;
  title: string;
  catalogId: string;
  catalogName: string;
  visibility: "LINK" | "LISTED";
  showPrices: ShowPrices;
  status: "DRAFT" | "LIVE";
  leadCount: number;
  newLeadCount: number;
}

export async function listPublicCatalogs(shopDomain: string): Promise<PublicCatalogRow[]> {
  const shop = await shopFor(shopDomain);
  if (!shop) return [];
  const rows = await prisma.publicCatalog.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "asc" },
    include: {
      catalog: { select: { name: true } },
      _count: { select: { leads: true } },
      leads: { where: { status: "NEW" }, select: { id: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    catalogId: r.catalogId,
    catalogName: r.catalog.name,
    visibility: r.visibility,
    showPrices: r.showPrices,
    status: r.status,
    leadCount: r._count.leads,
    newLeadCount: r.leads.length,
  }));
}

export async function createPublicCatalog(
  shopDomain: string,
  input: { catalogId: string; title: string },
  plan: string | null,
): Promise<string> {
  if (!catalogSharingAllowed(plan)) throw new NotAllowedError("Catalog sharing is a Growth feature.");
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError("Unknown shop");

  // The catalog must belong to this shop (never publish another store's catalog).
  const catalog = await prisma.catalog.findFirst({ where: { id: input.catalogId, shopId: shop.id }, select: { id: true, name: true } });
  if (!catalog) throw new NotFoundError("Catalog not found");

  const title = input.title.trim() || catalog.name;
  const existing = await prisma.publicCatalog.findMany({ where: { shopId: shop.id }, select: { slug: true } });
  const slug = uniqueSlug(slugify(title), existing.map((e) => e.slug));

  const pub = await prisma.publicCatalog.create({
    data: { shopId: shop.id, catalogId: catalog.id, title, slug, status: "DRAFT" },
    select: { id: true },
  });
  return pub.id;
}

async function ownedPublicCatalog(shopDomain: string, id: string) {
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError("Unknown shop");
  const pub = await prisma.publicCatalog.findFirst({ where: { id, shopId: shop.id } });
  if (!pub) throw new NotFoundError("Public catalog not found");
  return { shop, pub };
}

export async function updatePublicCatalog(
  shopDomain: string,
  id: string,
  input: { title?: string; visibility?: "LINK" | "LISTED"; showPrices?: ShowPrices },
): Promise<void> {
  await ownedPublicCatalog(shopDomain, id);
  await prisma.publicCatalog.update({
    where: { id },
    data: {
      title: input.title?.trim() || undefined,
      visibility: input.visibility,
      showPrices: input.showPrices,
    },
  });
}

/** Publish (LIVE) or unpublish (DRAFT). Publishing emits PUBLIC_CATALOG_PUBLISHED. */
export async function setPublished(shopDomain: string, id: string, live: boolean): Promise<void> {
  const { shop } = await ownedPublicCatalog(shopDomain, id);
  await prisma.publicCatalog.update({ where: { id }, data: { status: live ? "LIVE" : "DRAFT" } });
  if (live) {
    await appendEvent({
      shopId: shop.id,
      type: "PUBLIC_CATALOG_PUBLISHED",
      entityType: "PublicCatalog",
      entityId: id,
      payload: {},
    });
  }
}

export async function deletePublicCatalog(shopDomain: string, id: string): Promise<void> {
  await ownedPublicCatalog(shopDomain, id);
  await prisma.publicCatalog.delete({ where: { id } });
}

// --- public rendering (the price-protection boundary) ------------------------

export interface PublicProduct {
  variantId: string;
  title: string;
  sku: string | null;
  price: string | null; // null unless showPrices = PUBLIC
  currency: string;
  moq: number | null;
}

export interface PublicCatalogView {
  title: string;
  shopDomain: string;
  showPrices: ShowPrices;
  priceNotice: string | null;
  meta: { title: string; description: string };
  products: PublicProduct[];
}

/**
 * Resolve a live public catalog for anonymous viewing. Products come through the
 * SAME F11 visibility resolution as the portal (hidden SKUs never leak); prices
 * appear only when showPrices = PUBLIC. Returns null when not found / not live.
 */
export async function getPublicCatalogView(shopDomain: string, slug: string): Promise<PublicCatalogView | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return null;
  const pub = await prisma.publicCatalog.findFirst({
    where: { shopId: shop.id, slug, status: "LIVE" },
    include: { catalog: { select: { id: true, visibility: true, items: true } } },
  });
  if (!pub) return null;

  let full: CatalogItem[] = [];
  try {
    full = await getCatalog(shopDomain);
  } catch {
    full = [];
  }

  // Restrict to the chosen catalog's visible set (F11 semantics, deny-by-default).
  const v = buildVisibility(
    { id: pub.catalog.id, visibility: pub.catalog.visibility },
    pub.catalog.items.map((i) => ({ productId: i.productId, variantId: i.variantId, hidden: i.hidden })),
  );
  const visible = v.mode === "open" ? full : filterVisible(full, v);

  const showPublicPrices = pricesVisibleOnPublicPage(pub.showPrices);

  // MOQ (F9) — public, anonymous context (no company/group), best-effort.
  let rules: Awaited<ReturnType<typeof getRulesForShop>> = [];
  try {
    rules = await getRulesForShop(shopDomain);
  } catch {
    rules = [];
  }
  const moqFor = (variantId: string): number | null => {
    if (rules.length === 0) return null;
    const matched = matchingRules(rules, { variantId });
    return matched.find((r) => r.minQty != null)?.minQty ?? null;
  };

  const products: PublicProduct[] = visible.map((item) => ({
    variantId: item.variantId,
    title: item.displayTitle,
    sku: item.sku,
    price: showPublicPrices ? item.price : null,
    currency: item.currencyCode,
    moq: moqFor(item.variantId),
  }));

  return {
    title: pub.title,
    shopDomain,
    showPrices: pub.showPrices,
    priceNotice: priceNotice(pub.showPrices),
    meta: buildPublicMeta(pub.title, shopDomain, products.length),
    products,
  };
}

/** The opt-in in-app discovery index: listed + live public catalogs across shops. */
export async function listDiscovery(limit = 60): Promise<Array<{ shopDomain: string; slug: string; title: string; productHint: number }>> {
  const rows = await prisma.publicCatalog.findMany({
    where: { visibility: "LISTED", status: "LIVE" },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { shop: { select: { shopifyDomain: true } }, catalog: { select: { _count: { select: { items: true } } } } },
  });
  return rows.map((r) => ({
    shopDomain: r.shop.shopifyDomain,
    slug: r.slug,
    title: r.title,
    productHint: r.catalog._count.items,
  }));
}

// --- leads -------------------------------------------------------------------

export type LeadResult = { ok: true } | { ok: false; error: string };

/**
 * Capture a "request wholesale access" submission from a public page. Honeypot +
 * rate-limited (shared with F6). A tripped honeypot returns a generic OK so bots
 * learn nothing. Dedupes by (publicCatalog, email) while a lead is still NEW.
 * Emits CATALOG_LEAD_CREATED and emails the merchant (best-effort).
 */
export async function createLead(
  shopDomain: string,
  slug: string,
  payload: { email?: unknown; companyName?: unknown; message?: unknown; honeypot: unknown; rateKey: string; baseUrl: string; now?: number },
): Promise<LeadResult> {
  const now = payload.now ?? Date.now();
  if (isHoneypotTripped(payload.honeypot)) return { ok: true }; // silent success

  if (!submitRateOk(payload.rateKey, now)) {
    return { ok: false, error: "Too many requests right now. Please try again in a minute." };
  }

  const v = validateLead(payload);
  if (!v.ok) return { ok: false, error: v.error ?? "Please check the form." };

  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "This store isn’t taking requests right now." };
  const pub = await prisma.publicCatalog.findFirst({
    where: { shopId: shop.id, slug, status: "LIVE" },
    select: { id: true, title: true },
  });
  if (!pub) return { ok: false, error: "This catalog isn’t available right now." };

  // Dedupe: an open request from the same email doesn't pile up.
  const existing = await prisma.catalogLead.findFirst({
    where: { publicCatalogId: pub.id, email: v.email, status: "NEW" },
    select: { id: true },
  });
  if (existing) return { ok: true };

  await prisma.catalogLead.create({
    data: { publicCatalogId: pub.id, email: v.email, companyName: v.companyName, message: v.message, status: "NEW" },
  });

  await appendEvent({
    shopId: shop.id,
    type: "CATALOG_LEAD_CREATED",
    entityType: "PublicCatalog",
    entityId: pub.id,
    payload: {}, // ids only — no PII (guardrail #6)
  });

  // Merchant new-lead notice (best-effort).
  try {
    const tpl = resolveTemplate("catalog_lead_created", shop.emailTemplates);
    const alertTo = process.env.MANNON_MERCHANT_ALERT_EMAIL;
    if (alertTo) {
      const { subject, body } = renderTemplate(tpl, {
        catalogTitle: pub.title,
        companyName: v.companyName ?? "A visitor",
        buyerEmail: v.email,
        shopName: shopDomain,
      });
      await sendEmail({ to: alertTo, subject, html: body.replace(/\n/g, "<br>"), text: body });
    }
  } catch (error) {
    captureException(error);
  }

  return { ok: true };
}

export interface LeadRow {
  id: string;
  email: string;
  companyName: string | null;
  message: string | null;
  status: "NEW" | "APPROVED" | "DECLINED";
  createdAt: Date;
  catalogTitle: string;
}

export async function listLeads(shopDomain: string): Promise<LeadRow[]> {
  const shop = await shopFor(shopDomain);
  if (!shop) return [];
  const rows = await prisma.catalogLead.findMany({
    where: { publicCatalog: { shopId: shop.id } },
    orderBy: { createdAt: "desc" },
    include: { publicCatalog: { select: { title: true } } },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    companyName: r.companyName,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt,
    catalogTitle: r.publicCatalog.title,
  }));
}

/**
 * Approve a lead: run the F6 provisioning pipeline (Company + magic-link buyer +
 * default price list), assign the published catalog (F11) to the new company so
 * they see real prices, and email the buyer a welcome + secure link. Idempotent
 * on already-decided leads.
 */
export async function approveLead(shopDomain: string, leadId: string, reviewedBy: string, baseUrl: string): Promise<LeadResult> {
  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "Unknown shop." };
  const lead = await prisma.catalogLead.findFirst({
    where: { id: leadId, publicCatalog: { shopId: shop.id } },
    include: { publicCatalog: { select: { catalogId: true, title: true } } },
  });
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.status !== "NEW") return { ok: true }; // already decided

  // F6 pipeline: create an application, then provision (Company + buyer + magic link).
  const application = await prisma.wholesaleApplication.create({
    data: {
      shopId: shop.id,
      companyName: lead.companyName ?? "Wholesale buyer",
      contactEmail: lead.email,
      answers: { source: "catalog_lead", catalog: lead.publicCatalog.title } as object,
      status: "PENDING",
      tags: ["catalog-lead"],
    },
    select: { id: true },
  });

  const provision = await provisionApproval(application.id, shopDomain, reviewedBy, baseUrl);
  const provisioned = await prisma.wholesaleApplication.findUnique({ where: { id: application.id }, select: { companyId: true } });
  const companyId = provisioned?.companyId ?? null;

  // F11: assign the published catalog to the new company so prices/products unlock.
  if (companyId) {
    try {
      await assignCatalog(shopDomain, { catalogId: lead.publicCatalog.catalogId, scope: "COMPANY", targetId: companyId }, shop.plan);
    } catch (error) {
      captureException(error);
    }
  }

  await prisma.catalogLead.update({ where: { id: lead.id }, data: { status: "APPROVED" } });

  // Welcome + secure link (best-effort).
  try {
    const tpl = resolveTemplate("catalog_access_approved", shop.emailTemplates);
    const { subject, body } = renderTemplate(tpl, {
      companyName: lead.companyName ?? "there",
      catalogTitle: lead.publicCatalog.title,
      portalUrl: provision?.magicUrl ?? `${baseUrl.replace(/\/$/, "")}/portal`,
      shopName: shopDomain,
    });
    await sendEmail({ to: lead.email, subject, html: body.replace(/\n/g, "<br>"), text: body });
  } catch (error) {
    captureException(error);
  }

  return { ok: true };
}

export async function declineLead(shopDomain: string, leadId: string): Promise<LeadResult> {
  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "Unknown shop." };
  const updated = await prisma.catalogLead.updateMany({
    where: { id: leadId, publicCatalog: { shopId: shop.id }, status: "NEW" },
    data: { status: "DECLINED" },
  });
  if (updated.count === 0) return { ok: false, error: "Lead not found." };
  return { ok: true };
}
