import prisma from "../db.server";
import { storeSender } from "./store-sender.server";
import { shopNameFor } from "./shop-name.server";
import { captureException } from "../lib/sentry.server";
import { renderTemplate, resolveTemplate, sendEmail, type SendResult, type TemplateKey } from "./mailer.server";
import { issueBuyerQuoteLink } from "./buyer-sign-in-link.server";
import { alertMerchant } from "./merchant-alerts.server";

/**
 * The emails that carry a quote from request to order (Phase 2, flow 5.2):
 *   received → the merchant is alerted and the buyer gets a confirmation
 *   priced   → the buyer gets the quote with a sign-in link (quote_sent)
 *   ordered  → the buyer is told the order is placed (quote_ordered)
 *
 * Every send is logged (EmailDelivery) against the quote, so the quote page
 * shows whether it arrived. Each function returns the sign-in link it used, so
 * the merchant can copy it when the send didn't go through. Best-effort: a
 * failed email never fails the quote action.
 */
export interface QuoteEmailResult {
  result: SendResult;
  to: string;
  link: { url: string; expiresAt: string } | null;
}

function appUrl(baseUrl?: string): string {
  return (baseUrl || process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
}

async function quoteContext(quoteId: string) {
  return prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      expiresAt: true,
      buyer: { select: { id: true, email: true, name: true, localePreference: { select: { locale: true } } } },
      company: { select: { name: true, shop: { select: { id: true, shopifyDomain: true, emailTemplates: true } } } },
    },
  });
}

async function sendToBuyer(
  quoteId: string,
  template: TemplateKey,
  baseUrl?: string,
): Promise<QuoteEmailResult | null> {
  const q = await quoteContext(quoteId);
  if (!q) return null;
  const shop = q.company.shop;
  // A fresh sign-in link that opens this quote: the buyer has no password.
  const link = await issueBuyerQuoteLink(shop.shopifyDomain, quoteId, appUrl(baseUrl));
  const quoteUrl = link?.url ?? `${appUrl(baseUrl)}/portal/quotes/${quoteId}`;
  const locale = q.buyer.localePreference?.locale ?? "en";
  const { subject, body } = renderTemplate(resolveTemplate(template, shop.emailTemplates, locale), {
    buyerName: q.buyer.name ?? "there",
    shopName: await shopNameFor(shop.shopifyDomain),
    companyName: q.company.name,
    quoteUrl,
    expiresAt: q.expiresAt.toISOString().slice(0, 10),
  });
  const result = await sendEmail(
    { ...(await storeSender(shop.shopifyDomain)), to: q.buyer.email, subject, html: body.replace(/\n/g, "<br>"), text: body, tag: template },
    { shopId: shop.id, template, entityType: "Quote", entityId: quoteId },
  );
  return {
    result,
    to: q.buyer.email,
    link: link ? { url: link.url, expiresAt: link.expiresAt.toISOString() } : null,
  };
}

/** The merchant priced or countered the quote: send it to the buyer. */
export function emailQuoteSent(quoteId: string, baseUrl?: string): Promise<QuoteEmailResult | null> {
  return sendToBuyer(quoteId, "quote_sent", baseUrl);
}

/** The quote became an order. Best-effort and never throws. */
export async function emailQuoteOrdered(quoteId: string, baseUrl?: string): Promise<void> {
  try {
    await sendToBuyer(quoteId, "quote_ordered", baseUrl);
  } catch (error) {
    captureException(error);
  }
}

/**
 * A buyer submitted a quote from the portal: alert the merchant and confirm
 * to the buyer. Best-effort and never throws.
 */
export async function emailQuoteReceived(quoteId: string, baseUrl?: string): Promise<void> {
  try {
    const q = await quoteContext(quoteId);
    if (!q) return;
    const shop = q.company.shop;
    const lines = await prisma.quoteLine.count({ where: { quoteId } });
    const alert = renderTemplate(resolveTemplate("quote_request_created", shop.emailTemplates), {
      email: q.buyer.email,
      companyLine: `\nCompany: ${q.company.name}`,
      itemCount: String(lines),
      requestUrl: `${appUrl(baseUrl)}/app/quotes/${quoteId}`,
    });
    await alertMerchant(shop.shopifyDomain, { subject: alert.subject, text: alert.body }, { template: "quote_request_created", entityType: "Quote", entityId: quoteId });
    const ack = renderTemplate(resolveTemplate("quote_request_ack", shop.emailTemplates, q.buyer.localePreference?.locale ?? "en"), {
      shopName: await shopNameFor(shop.shopifyDomain),
    });
    await sendEmail(
      { ...(await storeSender(shop.shopifyDomain)), to: q.buyer.email, subject: ack.subject, html: ack.body.replace(/\n/g, "<br>"), text: ack.body, tag: "quote_request_ack" },
      { shopId: shop.id, template: "quote_request_ack", entityType: "Quote", entityId: quoteId },
    );
  } catch (error) {
    captureException(error);
  }
}
