/**
 * Native B2B payment terms (F4). We READ the store's payment-terms templates
 * (net 7–90, due on fulfillment, etc.) to display them and to attach a chosen
 * one to a draft order. We never build a terms engine — Shopify defines and
 * enforces terms. Cached like the catalog for fast portal loads.
 *
 * Confirm the paymentTermsTemplates fields against the current Admin API via the
 * Shopify Dev MCP.
 */

export interface PaymentTerm {
  id: string; // gid://shopify/PaymentTermsTemplate/...
  name: string;
  paymentTermsType: string; // e.g. NET, RECEIPT, FIXED, FULFILLMENT
  dueInDays: number | null;
}

export const PAYMENT_TERMS_CACHE_TTL_MS = 10 * 60 * 1000;

const PAYMENT_TERMS_QUERY = `#graphql
  query MannonPaymentTerms {
    paymentTermsTemplates {
      id
      name
      paymentTermsType
      dueInDays
    }
  }
`;

interface RawTerms {
  paymentTermsTemplates?: Array<{
    id: string;
    name: string;
    paymentTermsType?: string;
    dueInDays?: number | null;
  }>;
}

/** Pure mapping from the Admin response to display-ready terms. */
export function mapPaymentTermsTemplates(data: RawTerms): PaymentTerm[] {
  return (data.paymentTermsTemplates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    paymentTermsType: t.paymentTermsType ?? "NET",
    dueInDays: t.dueInDays ?? null,
  }));
}

interface AdminLike {
  graphql: (query: string) => Promise<{ json: () => Promise<unknown> }>;
}

export async function fetchPaymentTermsFromShopify(shop: string): Promise<PaymentTerm[]> {
  // Lazy import so pure helpers stay testable without booting the Shopify app.
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = (await unauthenticated.admin(shop)) as { admin: AdminLike };
  const response = await admin.graphql(PAYMENT_TERMS_QUERY);
  const body = (await response.json()) as { data?: RawTerms };
  return mapPaymentTermsTemplates(body.data ?? {});
}

interface CacheEntry {
  terms: PaymentTerm[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export async function getPaymentTerms(
  shop: string,
  options: { loader?: () => Promise<PaymentTerm[]>; now?: number; ttlMs?: number } = {},
): Promise<PaymentTerm[]> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? PAYMENT_TERMS_CACHE_TTL_MS;
  const cached = cache.get(shop);
  if (cached && cached.expiresAt > now) return cached.terms;

  const loader = options.loader ?? (() => fetchPaymentTermsFromShopify(shop));
  const terms = await loader();
  cache.set(shop, { terms, expiresAt: now + ttlMs });
  return terms;
}

export function clearPaymentTermsCache(shop?: string): void {
  if (shop) cache.delete(shop);
  else cache.clear();
}

/** Plain-language label for display, e.g. "Net 30" or "Due on fulfillment". */
export function paymentTermLabel(term: PaymentTerm): string {
  return term.name;
}
