import prisma from "../db.server";
import { draft, type ClaudeInvoke } from "./claude.server";
import { STRINGS, isSupportedLocale, localeName, type StringKey } from "../lib/i18n";

/**
 * F16 i18n — DB orchestration for the Claude translation draft. Calls the
 * generic draft() with the portal_translations feature, then VALIDATES the
 * model's output against the known string catalog (guardrail: never trust the
 * model's keys) before returning overrides that pre-fill the merchant's JSON.
 */

/** The canonical keys we translate (the English source is the truth). */
export const TRANSLATABLE_KEYS = Object.keys(STRINGS.en) as StringKey[];

/**
 * Keep only known keys with non-empty string values. Unknown keys the model may
 * invent are dropped. Pure — the validation boundary, unit-tested.
 */
export function sanitizeTranslations(
  raw: unknown,
  allowedKeys: readonly string[] = TRANSLATABLE_KEYS,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  const allow = new Set(allowedKeys);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (allow.has(k) && typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export class UnsupportedLocaleError extends Error {}

export interface TranslationDraft {
  locale: string;
  translations: Record<string, string>;
  /** How many of the catalog keys the model actually returned. */
  covered: number;
  total: number;
}

/** Draft portal translations for one locale. Returns null when the shop is missing. */
export async function draftPortalTranslations(
  shopDomain: string,
  localeCode: string,
  options: { invoke?: ClaudeInvoke } = {},
): Promise<TranslationDraft | null> {
  if (!isSupportedLocale(localeCode) || localeCode === "en") {
    throw new UnsupportedLocaleError(`Can't translate into "${localeCode}".`);
  }
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) return null;

  const { output } = await draft({
    feature: "portal_translations",
    shopId: shop.id,
    input: {
      localeCode,
      localeName: localeName(localeCode),
      sourceStrings: STRINGS.en as unknown as Record<string, string>,
    },
    invoke: options.invoke,
  });

  const translations = sanitizeTranslations((output as Record<string, unknown>).translations);
  return {
    locale: localeCode,
    translations,
    covered: Object.keys(translations).length,
    total: TRANSLATABLE_KEYS.length,
  };
}
