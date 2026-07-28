// F19 — pure logic for public catalog sharing: slug generation, lead validation,
// the price-protection decision, and SEO meta. No Prisma, no network — unit-tested.
// Honeypot spam-guard is shared with F6 (lib/wholesale).
import { HONEYPOT_FIELD, isHoneypotTripped } from "./wholesale";

export { HONEYPOT_FIELD, isHoneypotTripped };

export type ShowPrices = "HIDDEN" | "AFTER_APPROVAL" | "PUBLIC";

/**
 * The price-protection guarantee, in one pure function: prices are shown on the
 * PUBLIC page only when the merchant explicitly chose PUBLIC. HIDDEN and
 * AFTER_APPROVAL both keep prices off the public page (AFTER_APPROVAL prices
 * unlock later, inside the portal, once the buyer is approved). Default-safe.
 */
export function pricesVisibleOnPublicPage(showPrices: ShowPrices): boolean {
  return showPrices === "PUBLIC";
}

/** Human copy explaining the price state on a public page. Pure. */
export function priceNotice(showPrices: ShowPrices): string | null {
  switch (showPrices) {
    case "PUBLIC":
      return null;
    case "AFTER_APPROVAL":
      return "Wholesale prices unlock once you’re approved — request access below.";
    case "HIDDEN":
    default:
      return "Wholesale prices are shared with approved buyers. Request access below.";
  }
}

/** Slugify a title into a URL-safe segment. Pure, deterministic. */
export function slugify(input: string): string {
  const base = (input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "catalog";
}

/**
 * Pick a slug that doesn't collide with `taken`. Appends -2, -3, … as needed.
 * Pure so it's testable; the caller passes the current set of slugs for the shop.
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const base = slugify(desired);
  if (!set.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidatedLead {
  ok: boolean;
  email: string;
  companyName: string | null;
  message: string | null;
  error?: string;
}

/** Validate a "request access" submission. Pure (no rate limit / honeypot here). */
export function validateLead(input: {
  email?: unknown;
  companyName?: unknown;
  message?: unknown;
}): ValidatedLead {
  const email = String(input.email ?? "").trim().toLowerCase();
  const companyName = String(input.companyName ?? "").trim().slice(0, 120) || null;
  const message = String(input.message ?? "").trim().slice(0, 1000) || null;
  if (!EMAIL_RE.test(email)) {
    return { ok: false, email, companyName, message, error: "Enter a valid email address." };
  }
  return { ok: true, email, companyName, message };
}

export interface PublicMeta {
  title: string;
  description: string;
}

/** SEO title/description for a public catalog page. Pure. */
export function buildPublicMeta(title: string, shopName: string, productCount: number): PublicMeta {
  const clean = (title ?? "").trim() || "Wholesale catalog";
  return {
    title: `${clean} — Wholesale`,
    description:
      productCount > 0
        ? `Browse ${productCount} wholesale product${productCount === 1 ? "" : "s"} from ${shopName} and request trade access.`
        : `Wholesale catalog from ${shopName}. Request trade access to see prices and order.`,
  };
}
