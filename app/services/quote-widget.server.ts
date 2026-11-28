import prisma from "../db.server";
import { storeSender } from "./store-sender.server";
import { shopNameFor } from "./shop-name.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { submitRateOk } from "./wholesale.server";
import { getVisibleCatalog } from "./catalogs.server";
import { submitBuyerQuote } from "./portal-quote.server";
import { RequestAlreadyHandledError } from "./quote.server";
import { quoteWidgetFeatures, type QuoteWidgetFeatures } from "../lib/billing";
import { validateQuoteRequest, type QuoteRequestInput, type CleanLine } from "../lib/quote-widget";
import { formBelongsToShop, QUOTE_CAPTURE_ENABLED } from "./quote-form.server";
import { assertCanAddCompany, CompanyCapError } from "./plan-limits.server";
import { alertMerchant } from "./merchant-alerts.server";

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
    select: { id: true, plan: true, quoteWidgetEnabled: true, quoteWidgetLabel: true, quoteWidgetGated: true, quoteWidgetCartEnabled: true, quoteWidgetCustomFields: true, emailTemplates: true },
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
  //  · CAPTURE (F24.3 Add-to-Quote / cart→quote) — gated by the F24 flag + the
  //    same merchant toggle. Not by plan: a storefront block that silently
  //    renders nothing on Free/Starter fails App Store review 5.1.2.
  const channelOk =
    input.channel === "CAPTURE"
      ? QUOTE_CAPTURE_ENABLED() && shop.quoteWidgetEnabled
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

  // A request from a buyer the store already has becomes a quote with status
  // New straight away. Best-effort: if it can't, the request waits in Requests.
  let quoteId: string | null = null;
  try {
    const converted = await convertToQuote(shopDomain, request.id, { onlyKnownBuyer: true });
    if (converted.ok) quoteId = converted.quoteId;
  } catch (error) {
    captureException(error);
  }

  // Alert the merchant and confirm to the visitor (best-effort; the request is
  // already saved). Both attempts are logged, so a failed send shows in the admin.
  try {
    const appUrl = ctx.baseUrl.replace(/\/$/, "");
    const requestUrl = quoteId ? `${appUrl}/app/quotes/${quoteId}` : `${appUrl}/app/quote-requests`;
    const m = renderTemplate(resolveTemplate("quote_request_created", shop.emailTemplates ?? null), {
      email: clean.value.email,
      companyLine: clean.value.companyName ? `\nCompany: ${clean.value.companyName}` : "",
      itemCount: String(clean.value.lines.length),
      requestUrl,
    });
    await alertMerchant(shopDomain, { subject: m.subject, text: m.body }, { template: "quote_request_created", entityType: "QuoteRequest", entityId: request.id });
    const a = renderTemplate(resolveTemplate("quote_request_ack", shop.emailTemplates ?? null), { shopName: await shopNameFor(shopDomain) });
    await sendEmail(
      { ...(await storeSender(shopDomain)), to: clean.value.email, subject: a.subject, html: a.body.replace(/\n/g, "<br>"), text: a.body },
      { shopId: shop.id, template: "quote_request_ack", entityType: "QuoteRequest", entityId: request.id },
    );
  } catch (error) {
    captureException(error);
  }

  return { ok: true, requestId: request.id, ...(quoteId ? { quoteId } : {}) };
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
  const reply = await prepareRequestReply(shopDomain, id, body);
  if (!reply) return false;
  const result = await sendEmail({ ...(await storeSender(shopDomain)), to: reply.to, subject: "About your quote request", html: reply.text.replace(/\n/g, "<br>"), text: reply.text });
  // Only report a reply that actually went out.
  return result.sent;
}

/**
 * The reply and who it is for, scoped to the shop. A storefront requester has
 * no portal login, so email is the only way to reach them: while no sender is
 * connected the merchant copies this and sends it from their own inbox.
 */
export async function prepareRequestReply(shopDomain: string, id: string, body: string): Promise<{ to: string; text: string } | null> {
  const shop = await shopFor(shopDomain);
  if (!shop) return null;
  const request = await prisma.quoteRequest.findFirst({ where: { id, shopId: shop.id }, select: { id: true, email: true } });
  if (!request) return null;
  const text = body.trim();
  if (!text) return null;
  return { to: request.email, text };
}

/**
 * Ensure a Company + Buyer for a request's email. Reuses a known buyer (prefills
 * their company + price list); otherwise provisions a lightweight "lead" company
 * with a synthetic Shopify company id (reconciled on the first real order).
 */
async function ensureBuyer(shopId: string, email: string, companyName: string | null, requestId: string): Promise<{ buyerId: string; companyId: string }> {
  const known = await prisma.buyer.findFirst({ where: { email, company: { shopId } }, select: { id: true, companyId: true } });
  if (known) return { buyerId: known.id, companyId: known.companyId };

  // A new company account must fit the plan's limit (CompanyCapError otherwise).
  await assertCanAddCompany(shopId);
  const company = await prisma.company.create({ data: { shopId, shopifyCompanyId: `quote-request:${requestId}`, name: companyName || email } });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email, role: "ADMIN", status: "ACTIVE" } });
  return { buyerId: buyer.id, companyId: company.id };
}

export type ConvertResult = { ok: true; quoteId: string } | { ok: false; error: string };

/**
 * Turn a NEW storefront request into a quote with status New (SUBMITTED). The
 * request is marked CONVERTED in the quote's own transaction, so a request
 * becomes at most one quote: running this twice, or racing a merchant click,
 * returns the same quote. The request already alerted the merchant and
 * acknowledged the buyer, so the quote sends neither again.
 *
 * `onlyKnownBuyer`: used for automatic conversion (on arrival and in the
 * backfill). A request from a new email would add a company account, which
 * counts toward the plan's limit, so that stays the merchant's decision.
 */
export async function convertToQuote(shopDomain: string, id: string, opts: { onlyKnownBuyer?: boolean } = {}): Promise<ConvertResult> {
  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "Unknown shop." };
  const request = await prisma.quoteRequest.findFirst({ where: { id, shopId: shop.id } });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status === "CONVERTED" && request.convertedQuoteId) return { ok: true, quoteId: request.convertedQuoteId };
  if (request.status !== "NEW") return { ok: false, error: "This request was already handled." };

  let ensured: { buyerId: string; companyId: string };
  if (opts.onlyKnownBuyer) {
    const known = await prisma.buyer.findFirst({ where: { email: { equals: request.email, mode: "insensitive" }, status: "ACTIVE", company: { shopId: shop.id } }, select: { id: true, companyId: true } });
    if (!known) return { ok: false, error: "New buyer: create the quote from the request." };
    ensured = { buyerId: known.id, companyId: known.companyId };
  } else {
    try {
      ensured = await ensureBuyer(shop.id, request.email, request.companyName, request.id);
    } catch (error) {
      if (error instanceof CompanyCapError) return { ok: false, error: error.message };
      throw error;
    }
  }
  const { buyerId, companyId } = ensured;

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

  try {
    const result = await submitBuyerQuote({ id: buyerId, companyId }, selections, catalog, {
      fromRequest: { id: request.id, formId: request.formId },
      notify: false,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, quoteId: result.quote.id };
  } catch (error) {
    if (!(error instanceof RequestAlreadyHandledError)) throw error;
    // Someone else converted it first: return their quote.
    const now = await prisma.quoteRequest.findUnique({ where: { id: request.id }, select: { convertedQuoteId: true } });
    return now?.convertedQuoteId ? { ok: true, quoteId: now.convertedQuoteId } : { ok: false, error: "This request was already handled." };
  }
}

/**
 * Backfill, safe to run any number of times: turn every NEW request from a
 * known buyer into a quote. Requests from new emails, and ones whose items
 * aren't in the catalog, stay in Requests.
 */
export async function convertPendingRequests(shopDomain: string): Promise<{ converted: number; left: number }> {
  const shop = await shopFor(shopDomain);
  if (!shop) return { converted: 0, left: 0 };
  const pending = await prisma.quoteRequest.findMany({ where: { shopId: shop.id, status: "NEW" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  let converted = 0;
  for (const r of pending) {
    try {
      const result = await convertToQuote(shopDomain, r.id, { onlyKnownBuyer: true });
      if (result.ok) converted++;
    } catch (error) {
      captureException(error);
    }
  }
  return { converted, left: pending.length - converted };
}
