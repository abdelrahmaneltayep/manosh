// F16 — pure i18n: supported locales, direction (RTL for Arabic), the portal
// string dictionary with fallback, and Intl-based number/date/money formatting.
// No Prisma, no network — unit-tested. Arabic is RTL: `dir()` mirrors the whole
// shell, not just text.

export type Dir = "ltr" | "rtl";

export interface LocaleMeta {
  code: string;
  name: string; // endonym
  dir: Dir;
}

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "fr", name: "Français", dir: "ltr" },
];

export const DEFAULT_LOCALE = "en";

export function isSupportedLocale(code: string | null | undefined): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === code);
}

/** Layout direction for a locale (rtl for Arabic). Falls back to ltr. Pure. */
export function localeDir(code: string | null | undefined): Dir {
  return SUPPORTED_LOCALES.find((l) => l.code === code)?.dir ?? "ltr";
}

export function localeName(code: string): string {
  return SUPPORTED_LOCALES.find((l) => l.code === code)?.name ?? code;
}

// --- portal string dictionary ------------------------------------------------

/** Keys used across the buyer portal shell + key flows. EN is the source. */
export const STRINGS = {
  en: {
    portal_title: "Wholesale portal",
    your_portal: "Your portal",
    quotes: "Quotes",
    order_pad: "Order pad",
    reorder: "Reorder",
    request_quote: "Request a quote",
    tax_details: "Tax details",
    sign_out: "Sign out",
    language: "Language",
    currency: "Currency",
    subtotal: "Subtotal",
    total: "Total",
    submit: "Submit",
    you_save: "You save",
    priced_in: "Priced in {{currency}}",
    rate_locked: "Rate locked at {{rate}} on this quote",
  },
  ar: {
    portal_title: "بوابة الجملة",
    your_portal: "بوابتك",
    quotes: "عروض الأسعار",
    order_pad: "لوحة الطلب",
    reorder: "إعادة الطلب",
    request_quote: "طلب عرض سعر",
    tax_details: "التفاصيل الضريبية",
    sign_out: "تسجيل الخروج",
    language: "اللغة",
    currency: "العملة",
    subtotal: "المجموع الفرعي",
    total: "الإجمالي",
    submit: "إرسال",
    you_save: "توفّر",
    priced_in: "الأسعار بعملة {{currency}}",
    rate_locked: "سعر الصرف مثبّت عند {{rate}} على هذا العرض",
  },
  fr: {
    portal_title: "Portail de gros",
    your_portal: "Votre portail",
    quotes: "Devis",
    order_pad: "Bloc de commande",
    reorder: "Recommander",
    request_quote: "Demander un devis",
    tax_details: "Détails fiscaux",
    sign_out: "Se déconnecter",
    language: "Langue",
    currency: "Devise",
    subtotal: "Sous-total",
    total: "Total",
    submit: "Envoyer",
    you_save: "Vous économisez",
    priced_in: "Prix en {{currency}}",
    rate_locked: "Taux fixé à {{rate}} sur ce devis",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

/**
 * Translate a key for a locale, applying merchant custom overrides first, then
 * the locale dictionary, then the EN fallback. `{{token}}` vars are filled. Pure.
 */
export function t(
  locale: string,
  key: StringKey,
  vars: Record<string, string> = {},
  overrides?: Record<string, Record<string, string>> | null,
): string {
  const override = overrides?.[locale]?.[key];
  const dict = (STRINGS as Record<string, Record<string, string>>)[locale] ?? {};
  const base = override ?? dict[key] ?? STRINGS.en[key] ?? key;
  return base.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

// --- Intl formatting ---------------------------------------------------------

const localeTag: Record<string, string> = { en: "en-US", ar: "ar-SA", fr: "fr-FR" };

function tagFor(locale: string): string {
  return localeTag[locale] ?? locale;
}

/** Format money in the buyer's locale + currency. Amount is a string/number. Pure. */
export function formatMoney(amount: string | number, currency: string, locale = DEFAULT_LOCALE): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(tagFor(locale), { style: "currency", currency }).format(safe);
  } catch {
    return `${currency} ${safe.toFixed(2)}`;
  }
}

export function formatNumber(value: number, locale = DEFAULT_LOCALE): string {
  try {
    return new Intl.NumberFormat(tagFor(locale)).format(value);
  } catch {
    return String(value);
  }
}

export function formatDate(date: Date, locale = DEFAULT_LOCALE): string {
  try {
    return new Intl.DateTimeFormat(tagFor(locale), { year: "numeric", month: "short", day: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
