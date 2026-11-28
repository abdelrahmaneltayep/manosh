import prisma from "../db.server";
import { forgetShopName } from "./shop-name.server";
import { captureException } from "../lib/sentry.server";
import { sendEmail, type DeliveryMeta, type SendResult } from "./mailer.server";

/**
 * Where a store's own alerts go ("new request", sync failures, data requests).
 * Each store sets its addresses in Settings › Notifications; until it does, the
 * store's contact email from Shopify is filled in on the next admin visit
 * (ensureAlertEmails). MANNON_MERCHANT_ALERT_EMAIL is only a single-store
 * fallback for local development.
 */
export async function merchantAlertAddresses(shopDomain: string): Promise<string[]> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { alertEmails: true } });
  const saved = (shop?.alertEmails ?? []).filter(isEmail);
  if (saved.length) return saved;
  const fallback = process.env.MANNON_MERCHANT_ALERT_EMAIL?.trim();
  return fallback && isEmail(fallback) ? [fallback] : [];
}

/** Send one alert to every alert address. Returns one result per address. */
export async function alertMerchant(
  shopDomain: string,
  message: { subject: string; text: string; html?: string },
  meta?: Omit<DeliveryMeta, "shopId">,
): Promise<SendResult[]> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  const to = await merchantAlertAddresses(shopDomain);
  const results: SendResult[] = [];
  for (const address of to) {
    results.push(
      await sendEmail(
        { to: address, subject: message.subject, text: message.text, html: message.html ?? message.text, fromName: "Mannon" },
        shop ? { shopId: shop.id, ...meta } : undefined,
      ),
    );
  }
  return results;
}

/** Parse the Settings field: addresses separated by commas, spaces or new lines. */
export function parseAlertEmails(raw: string): { emails: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const emails = Array.from(new Set(parts.filter(isEmail))).slice(0, 10);
  return { emails, invalid: parts.filter((p) => !isEmail(p)) };
}

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

type AdminGraphql = { graphql: (query: string) => Promise<Response> };

/**
 * Admin visits: when the store has no alert address yet, use its contact email
 * from Shopify; keep the store name (shown to buyers in emails) up to date.
 * Best-effort; never blocks a page.
 */
export async function ensureAlertEmails(shopDomain: string, admin: AdminGraphql): Promise<void> {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { alertEmails: true, name: true, updatedAt: true } });
    if (!shop) return;
    const stale = !shop.name || Date.now() - shop.updatedAt.getTime() > 86_400_000;
    if (shop.alertEmails.length > 0 && !stale) return;
    const response = await admin.graphql(`#graphql
      query MannonShopContact { shop { name contactEmail email } }`);
    const json = (await response.json()) as { data?: { shop?: { name?: string | null; contactEmail?: string | null; email?: string | null } } };
    const name = json.data?.shop?.name?.trim();
    if (name && stale) {
      // Written even when unchanged, so the next check is a day away.
      await prisma.shop.update({ where: { shopifyDomain: shopDomain }, data: { name } });
      if (name !== shop.name) forgetShopName(shopDomain);
    }
    const contact = json.data?.shop?.contactEmail || json.data?.shop?.email || "";
    if (shop.alertEmails.length === 0 && isEmail(contact)) {
      await prisma.shop.updateMany({ where: { shopifyDomain: shopDomain, alertEmails: { isEmpty: true } }, data: { alertEmails: [contact.toLowerCase()] } });
    }
  } catch (error) {
    captureException(error);
  }
}
