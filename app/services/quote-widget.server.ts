import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { submitRateOk } from "./wholesale.server";
import { getVisibleCatalog } from "./catalogs.server";
import { submitBuyerQuote } from "./portal-quote.server";
import { quoteWidgetFeatures, quoteCaptureAllowed, type QuoteWidgetFeatures } from "../lib/billing";
import { validateQuoteRequest, type QuoteRequestInput, type CleanLine } from "../lib/quote-widget";
import { formBelongsToShop, QUOTE_CAPTURE_ENABLED } from "./quote-form.server";

/**
 * F17 — storefront "Request a Quote" widget service. Public submissions are
 * validated + escaped + anti-spam'd (honeypot + rate limit) before a QuoteRequest
 * is created; the merchant converts it to a real F1 Quote in one click. Hidden
 * catalog SKUs (F11) are never exposed to anonymous visitors. Dark-launched
 * behind MANNON_FF_QUOTE_WIDGET.
 */

export const WIDGET_ENABLED = () => process.env.MANNON_FF_QUOTE_WIDGET === "true";

export class NotFoundError extends Error {}

async function shopFor(shopDomain: string) {
  return prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, quoteWidgetEnabled: true, quoteWidgetLabel: true, quoteWidgetGated: true, quoteWidgetCartEnabled: true, quoteWidgetCustomFields: true },
  });
}

// --- public widget config ----------------------------------------------------

export interface WidgetConfig {
  enabled: boolean;
  label: string;
  gated: boolean;
  cartEnabled: boolean;
  customFields: Array<{ key: string; label: string }>;
  features: QuoteWidgetFeatures;
}

const DEFAULT_LABEL = "Request a Quote";

/** Public-safe widget config for a shop (no secrets). Respects the plan gating. */
export async function getWidgetConfig(shopDomain: string): Promise<WidgetConfig | null> {
  const shop = await shopFor(shopDomain);
  if (!shop) return null;
  const features = quoteWidgetFeatures(shop.plan);
  const rawFields = (shop.quoteWidgetCustomFields as Array<{ key: string; label: string }> | null) ?? [];
  return {
    enabled: WIDGET_ENABLED() && shop.quoteWidgetEnabled,
    label: shop.quoteWidgetLabel?.trim() || DEFAULT_LABEL,
    gated: features.gatedMode && shop.quoteWidgetGated,
    cartEnabled: features.cartLevel && shop.quoteWidgetCartEnabled,
    customFields: features.customFields ? rawFields : [],
    features,
  };
}

export interface SaveWidgetInput {
  enabled: boolean;
  label: string;
  gated: boolean;
  cartEnabled: boolean;
  customFields: Array<{ key: string; label: string }>;
}

export async function saveWidgetConfig(shopDomain: string, input: SaveWidgetInput): Promise<void> {
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError("Unknown shop");
  const features = quoteWidgetFeatures(shop.plan);
  await prisma.shop.update({
    where: { shopifyDomain: shopDomain },
    data: {
      quoteWidgetEnabled: input.enabled,
      quoteWidgetLabel: input.label.trim() || null,
      // Growth-only toggles are forced off on Starter regardless of the form.
      quoteWidgetGated: features.gatedMode ? input.gated : false,
      quoteWidgetCartEnabled: features.cartLevel ? input.cartEnabled : false,
      quoteWidgetCustomFields: features.customFields ? (input.customFields as object) : [],
    },
  });
}

// --- public submission -------------------------------------------------------

export type CreateResult =
  | { ok: true; requestId: string }
  | { ok: true; silent: true } // spam / rate-limited — return a generic success
  | { ok: false; error: string };

export async function createQuoteRequest(
  shopDomain: string,
  input: QuoteRequestInput & { source?: "PDP" | "CART" | "WIDGET"; formId?: string | null; channel?: "WIDGET" | "CAPTURE" },
  ctx: { rateKey: string; baseUrl: string; now?: number },
): Promise<CreateResult> {
  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "Quote requests aren’t available." };
  // Two entry channels share this path (same QuoteRequest + anti-spam + emails):
  //  · WIDGET (F17) — gated by the widget flag + the merchant's enable toggle.
  //  · CAPTURE (F24.3 Add-to-Quote / cart→quote) — gated by the F24 flag + a paid plan.
  const channelOk =
    input.channel === "CAPTURE"
      ? QUOTE_CAPTURE_ENABLED() && quoteCaptureAllowed(shop.plan)
      : WIDGET_ENABLED() && shop.quoteWidgetEnabled;
  if (!channelOk) return { ok: false, error: "Quote requests aren’t available." };

  // Anti-spam: rate limit by ip/shop, then validate (honeypot + too-fast inside).
  if (!submitRateOk(`qw:${ctx.rateKey}`, ctx.now ?? Date.now())) return { ok: true, silent: true };
  const clean = validateQuoteRequest(input);
  if (!clean.ok) {
    if (clean.spam) return { ok: true, silent: true }; // never reveal the honeypot
    return { ok: false, error: clean.error };
  }

  // Gated mode (Growth): only an already-approved (ACTIVE) buyer may submit.
  const features = quoteWidgetFeatures(shop.plan);
  if (features.gatedMode && shop.quoteWidgetGated) {
    const known = await prisma.buyer.findFirst({ where: { email: clean.value.email, status: "ACTIVE", company: { shopId: shop.id } }, select: { id: true } });
    if (!known) return { ok: false, error: "Quotes are available to approved wholesale accounts. Please apply first." };
  }

  // F24.1 — a submission from a merchant-built form carries its formId (validated
  // to belong to this shop). Form answers are always stored (the merchant
  // configured the form), independent of the legacy widget custom-fields gate.
  const formId = input.formId && (await formBelongsToShop(shop.id, input.formId)) ? input.formId : null;
  const customFields = formId ? clean.value.customFields : features.customFields ? clean.value.customFields : null;

  const request = await prisma.quoteRequest.create({
    data: {
      shopId: shop.id,
      source: (input.source ?? "PDP") as never,
      email: clean.value.email,
      companyName: clean.value.companyName,
      note: clean.value.note,
      lines: clean.value.lines as object,
      customFields: customFields as object,
      formId,
      status: "NEW",
    },
  });

  // Best-effort: the QuoteRequest is already saved. Never let the append-only
  // event log (analytics) turn a captured lead into a 500 for the storefront.
  try {
    await appendEvent({ shopId: shop.id, type: "QUOTE_REQUEST_CREATED", entityType: "QuoteRequest", entityId: request.id, payload: { source: input.source ?? "PDP", lines: clean.value.lines.length, ...(formId ? { formId } : {}) } });
  } catch (error) {
    captureException(error);
  }

  // Notify the merchant + auto-reply to the visitor (best-effort).
  try {
    const requestUrl = `${ctx.baseUrl.replace(/\/$/, "")}/app/quote-requests`;
    const merchantTo = process.env.MANNON_MERCHANT_ALERT_EMAIL;
    if (merchantTo) {
      const m = renderTemplate(resolveTemplate("quote_request_created", null), {
        email: clean.value.email,
        companyLine: clean.value.companyName ? `\nCompany: ${clean.value.companyName}` : "",
        itemCount: String(clean.value.lines.length),
        requestUrl,
      });
      await sendEmail({ to: merchantTo, subject: m.subject, html: m.body.replace(/\n/g, "<br>"), text: m.body });
    }
    const a = renderTemplate(resolveTemplate("quote_request_ack", null), { shopName: shopDomain });
    await sendEmail({ to: clean.value.email, subject: a.subject, html: a.body.replace(/\n/g, "<br>"), text: a.body });
  } catch (error) {
    captureException(error);
  }

  return { ok: true, requestId: request.id };
}

// --- merchant inbox ----------------------------------------------------------

export interface RequestRow {
  id: string;
  source: string;
  email: string;
  companyName: string | null;
  itemCount: number;
  note: string | null;
  status: string;
  convertedQuoteId: string | null;
  createdAt: Date;
}

export async function listQuoteRequests(shopDomain: string, status?: "NEW" | "CONVERTED" | "DECLINED"): Promise<RequestRow[]> {
  const shop = await shopFor(shopDomain);
  if (!shop) return [];
  const rows = await prisma.quoteRequest.findMany({ where: { shopId: shop.id, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    email: r.email,
    companyName: r.companyName,
    itemCount: Array.isArray(r.lines) ? (r.lines as unknown[]).length : 0,
    note: r.note,
    status: r.status,
    convertedQuoteId: r.convertedQuoteId,
    createdAt: r.createdAt,
  }));
}

export async function declineRequest(shopDomain: string, id: string): Promise<void> {
  const shop = await shopFor(shopDomain);
  if (!shop) return;
  await prisma.quoteRequest.updateMany({ where: { id, shopId: shop.id, status: "NEW" }, data: { status: "DECLINED" } });
}

export interface QuoteRequestContext {
  id: string;
  email: string;
  companyName: string | null;
  note: string | null;
  itemCount: number;
}

/** Load one owned request's context (for the Claude reply draft). */
export async function getQuoteRequestForShop(shopDomain: string, id: string): Promise<QuoteRequestContext | null> {
  const shop = await shopFor(shopDomain);
  if (!shop) return null;
  const r = await prisma.quoteRequest.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, email: true, companyName: true, note: true, lines: true },
  });
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    companyName: r.companyName,
    note: r.note,
    itemCount: Array.isArray(r.lines) ? (r.lines as unknown[]).length : 0,
  };
}

/**
 * Email a merchant-reviewed (e.g. Claude-drafted) acknowledgement reply to the
 * requester. Does not change the request status — the merchant still converts or
 * declines separately.
 */
export async function replyToRequest(shopDomain: string, id: string, body: string): Promise<boolean> {
  const shop = await shopFor(shopDomain);
  if (!shop) return false;
  const request = await prisma.quoteRequest.findFirst({ where: { id, shopId: shop.id }, select: { id: true, email: true } });
  if (!request) return false;
  const text = body.trim();
  if (!text) return false;
  await sendEmail({ to: request.email, subject: "About your quote request", html: text.replace(/\n/g, "<br>"), text });
  return true;
}

/**
 * Ensure a Company + Buyer for a request's email. Reuses a known buyer (prefills
 * their company + price list); otherwise provisions a lightweight "lead" company
 * with a synthetic Shopify company id (reconciled on the first real order).
 */
async function ensureBuyer(shopId: string, email: string, companyName: string | null, requestId: string): Promise<{ buyerId: string; companyId: string }> {
  const known = await prisma.buyer.findFirst({ where: { email, company: { shopId } }, select: { id: true, companyId: true } });
  if (known) return { buyerId: known.id, companyId: known.companyId };

  const company = await prisma.company.create({ data: { shopId, shopifyCompanyId: `quote-request:${requestId}`, name: companyName || email } });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email, role: "ADMIN", status: "ACTIVE" } });
  return { buyerId: buyer.id, companyId: company.id };
}

export type ConvertResult = { ok: true; quoteId: string } | { ok: false; error: string };

/** Convert a NEW request into a real F1 Quote in one click. */
export async function convertToQuote(shopDomain: string, id: string): Promise<ConvertResult> {
  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "Unknown shop." };
  const request = await prisma.quoteRequest.findFirst({ where: { id, shopId: shop.id } });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "NEW") return { ok: false, error: "This request was already handled." };

  const { buyerId, companyId } = await ensureBuyer(shop.id, request.email, request.companyName, request.id);

  // Resolve the request's lines against the buyer's VISIBLE catalog (F11) — a
  // hidden SKU can never be quoted. Match by variantId, else by SKU.
  const catalog = await getVisibleCatalog(shopDomain, { buyerId, companyId });
  const bySku = new Map(catalog.filter((c) => c.sku).map((c) => [c.sku!.toLowerCase(), c.variantId]));
  const variantIds = new Set(catalog.map((c) => c.variantId));
  const lines = (request.lines as unknown as CleanLine[]) ?? [];
  const selections: Array<{ variantId: string; quantity: number }> = [];
  for (const l of lines) {
    let variantId: string | null = null;
    if (l.variantId && variantIds.has(l.variantId)) variantId = l.variantId;
    else if (l.sku && bySku.has(l.sku.toLowerCase())) variantId = bySku.get(l.sku.toLowerCase())!;
    if (variantId) selections.push({ variantId, quantity: l.quantity });
  }
  if (selections.length === 0) return { ok: false, error: "None of the requested items matched your catalog. Reach out to the buyer directly." };

  const result = await submitBuyerQuote({ id: buyerId, companyId }, selections, catalog);
  if (!result.ok) return { ok: false, error: result.error };

  await prisma.quoteRequest.update({ where: { id: request.id }, data: { status: "CONVERTED", convertedQuoteId: result.quote.id } });
  // F24.1 — carry the originating form onto the created quote (quote.created carries formId).
  if (request.formId) {
    await prisma.quote.update({ where: { id: result.quote.id }, data: { formId: request.formId } });
  }
  return { ok: true, quoteId: result.quote.id };
}
