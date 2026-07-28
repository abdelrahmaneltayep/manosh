import type { RateSource } from "@prisma/client";
import { createCookie } from "@remix-run/node";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { getCatalog } from "./catalog.server";
import { DEFAULT_LOCALE, isSupportedLocale, localeDir, type Dir } from "../lib/i18n";
import { rateKey, resolveRate, lockFx, type RateMap, type LockedFx } from "../lib/currency";

/**
 * F16 — multi-currency + multi-language service. Resolves a buyer's locale +
 * currency (member > company > store default), holds the store's FX rates, and
 * locks a quote's rate at issue time. Dark-launched behind MANNON_FF_I18N; when
 * off, everyone gets the store default locale + currency exactly as before.
 */

export const I18N_ENABLED = () => process.env.MANNON_FF_I18N === "true";

// Session locale cookie (display preference; the buyer's persisted preference in
// LocalePreference still wins for authed flows and emails). Scoped to /portal.
export const localeCookie = createCookie("mannon_locale", { path: "/portal", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 180 });

export async function readLocaleCookie(request: Request): Promise<string | null> {
  const value = (await localeCookie.parse(request.headers.get("Cookie"))) as string | null;
  return value && isSupportedLocale(value) ? value : null;
}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

/** The store's base currency (from the live catalog; cached). Falls back to USD. */
export async function getStoreCurrency(shopDomain: string): Promise<string> {
  try {
    const items = await getCatalog(shopDomain);
    return items[0]?.currencyCode ?? "USD";
  } catch {
    return "USD";
  }
}

// --- shop settings -----------------------------------------------------------

export interface ShopI18n {
  defaultLocale: string;
  supportedLocales: string[];
  supportedCurrencies: string[];
  i18nStrings: Record<string, Record<string, string>>;
}

export async function getShopI18n(shopDomain: string): Promise<ShopI18n> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { defaultLocale: true, supportedLocales: true, supportedCurrencies: true, i18nStrings: true },
  });
  return {
    defaultLocale: shop?.defaultLocale ?? DEFAULT_LOCALE,
    supportedLocales: (shop?.supportedLocales as string[] | null) ?? [DEFAULT_LOCALE],
    supportedCurrencies: (shop?.supportedCurrencies as string[] | null) ?? [],
    i18nStrings: (shop?.i18nStrings as Record<string, Record<string, string>> | null) ?? {},
  };
}

export async function saveShopI18n(shopDomain: string, input: Partial<ShopI18n>): Promise<void> {
  const data: Record<string, unknown> = {};
  if (input.defaultLocale) data.defaultLocale = input.defaultLocale;
  if (input.supportedLocales) data.supportedLocales = input.supportedLocales;
  if (input.supportedCurrencies) data.supportedCurrencies = input.supportedCurrencies;
  if (input.i18nStrings) data.i18nStrings = input.i18nStrings;
  await prisma.shop.update({ where: { shopifyDomain: shopDomain }, data });
}

// --- FX rates ----------------------------------------------------------------

export interface RateRow {
  id: string;
  base: string;
  quote: string;
  rate: string;
  source: string;
}

export async function listRates(shopDomain: string): Promise<RateRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.currencyRate.findMany({ where: { shopId }, orderBy: [{ base: "asc" }, { quote: "asc" }] });
  return rows.map((r) => ({ id: r.id, base: r.base, quote: r.quote, rate: r.rate.toString(), source: r.source }));
}

export async function upsertRate(shopDomain: string, base: string, quote: string, rate: number, source: RateSource = "MANUAL"): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new Error("Unknown shop");
  const b = base.trim().toUpperCase();
  const q = quote.trim().toUpperCase();
  await prisma.currencyRate.upsert({
    where: { shopId_base_quote: { shopId, base: b, quote: q } },
    create: { shopId, base: b, quote: q, rate: rate.toFixed(8), source },
    update: { rate: rate.toFixed(8), source },
  });
}

export async function deleteRate(shopDomain: string, id: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.currencyRate.deleteMany({ where: { id, shopId } });
}

export async function getRateMap(shopDomain: string): Promise<RateMap> {
  const shopId = await shopIdFor(shopDomain);
  const map: RateMap = new Map();
  if (!shopId) return map;
  const rows = await prisma.currencyRate.findMany({ where: { shopId }, select: { base: true, quote: true, rate: true } });
  for (const r of rows) map.set(rateKey(r.base, r.quote), r.rate.toString());
  return map;
}

// --- buyer locale/currency preferences ---------------------------------------

export async function setLocalePreference(
  target: { companyId?: string; memberId?: string },
  locale: string,
  currency: string,
): Promise<void> {
  if (target.memberId) {
    await prisma.localePreference.upsert({
      where: { memberId: target.memberId },
      create: { memberId: target.memberId, locale, currency },
      update: { locale, currency },
    });
    const buyer = await prisma.buyer.findUnique({ where: { id: target.memberId }, select: { company: { select: { shopId: true } } } });
    if (buyer) await appendEvent({ shopId: buyer.company.shopId, type: "LOCALE_CHANGED", entityType: "Buyer", entityId: target.memberId, payload: { locale, currency } });
  } else if (target.companyId) {
    await prisma.localePreference.upsert({
      where: { companyId: target.companyId },
      create: { companyId: target.companyId, locale, currency },
      update: { locale, currency },
    });
    const company = await prisma.company.findUnique({ where: { id: target.companyId }, select: { shopId: true } });
    if (company) await appendEvent({ shopId: company.shopId, type: "LOCALE_CHANGED", entityType: "Company", entityId: target.companyId, payload: { locale, currency } });
  }
}

export interface BuyerI18nContext {
  locale: string;
  dir: Dir;
  currency: string; // display currency
  storeCurrency: string;
  rate: string | null; // store base -> display currency
  i18nStrings: Record<string, Record<string, string>>;
}

/**
 * Resolve the effective locale + currency for a buyer. Precedence for each:
 * member preference > company preference > store default. A cookie locale wins
 * for the current session if it's supported + enabled. When the flag is off,
 * everyone gets the store default locale + currency.
 */
export async function resolveBuyerContext(
  shopDomain: string,
  opts: { companyId?: string; memberId?: string; cookieLocale?: string | null },
): Promise<BuyerI18nContext> {
  const [settings, storeCurrency] = await Promise.all([getShopI18n(shopDomain), getStoreCurrency(shopDomain)]);
  const enabledLocales = new Set(settings.supportedLocales.length ? settings.supportedLocales : [settings.defaultLocale]);

  if (!I18N_ENABLED()) {
    return { locale: settings.defaultLocale, dir: localeDir(settings.defaultLocale), currency: storeCurrency, storeCurrency, rate: "1", i18nStrings: settings.i18nStrings };
  }

  const [memberPref, companyPref] = await Promise.all([
    opts.memberId ? prisma.localePreference.findUnique({ where: { memberId: opts.memberId } }) : Promise.resolve(null),
    opts.companyId ? prisma.localePreference.findUnique({ where: { companyId: opts.companyId } }) : Promise.resolve(null),
  ]);

  let locale = settings.defaultLocale;
  if (opts.cookieLocale && isSupportedLocale(opts.cookieLocale) && enabledLocales.has(opts.cookieLocale)) locale = opts.cookieLocale;
  else if (memberPref && enabledLocales.has(memberPref.locale)) locale = memberPref.locale;
  else if (companyPref && enabledLocales.has(companyPref.locale)) locale = companyPref.locale;

  const enabledCurrencies = new Set([storeCurrency, ...settings.supportedCurrencies]);
  let currency = storeCurrency;
  if (memberPref && enabledCurrencies.has(memberPref.currency)) currency = memberPref.currency;
  else if (companyPref && enabledCurrencies.has(companyPref.currency)) currency = companyPref.currency;

  const rates = await getRateMap(shopDomain);
  const rate = resolveRate(storeCurrency, currency, rates);

  return { locale, dir: localeDir(locale), currency, storeCurrency, rate, i18nStrings: settings.i18nStrings };
}

/**
 * Compute the FX to lock on a new quote for a buyer: their display currency +
 * the store-base→display rate (rate "1" in the base currency when unavailable),
 * so a counter-offer never drifts with FX. Flag off → base currency, rate 1.
 */
export async function resolveLockedFx(shopDomain: string, opts: { companyId?: string; memberId?: string }): Promise<LockedFx> {
  const storeCurrency = await getStoreCurrency(shopDomain);
  if (!I18N_ENABLED()) return { currency: storeCurrency, rate: "1" };
  const ctx = await resolveBuyerContext(shopDomain, opts);
  const rates = await getRateMap(shopDomain);
  return lockFx(storeCurrency, ctx.currency, rates);
}
