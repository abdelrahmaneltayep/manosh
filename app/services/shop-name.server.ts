import prisma from "../db.server";

/**
 * The store's name as buyers know it, for email subjects, bodies and the
 * sender name. Read from Shopify on admin visits (ensureAlertEmails); until
 * then the shop's domain without ".myshopify.com".
 */
export function storeName(shopDomain: string, name?: string | null): string {
  const saved = name?.trim();
  if (saved) return saved;
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

const cache = new Map<string, { name: string; at: number }>();
const TTL_MS = 5 * 60_000;

export async function shopNameFor(shopDomain: string): Promise<string> {
  const hit = cache.get(shopDomain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { name: true } }).catch(() => null);
  const name = storeName(shopDomain, shop?.name);
  cache.set(shopDomain, { name, at: Date.now() });
  return name;
}

/** Forget a cached name (after Shopify tells us a new one). */
export function forgetShopName(shopDomain: string): void {
  cache.delete(shopDomain);
}
