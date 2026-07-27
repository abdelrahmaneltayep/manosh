// F10 — pure, provider-agnostic accounting-sync logic. No Prisma, no network,
// no secrets: everything here is unit-tested and shared by the service and the
// routes. QBO/Xero HTTP lives in accounting.server.ts.

export type Provider = "QBO" | "XERO";
export type SyncEntity = "INVOICE" | "PAYMENT" | "CUSTOMER";
export type SyncStatus = "PENDING" | "SYNCED" | "FAILED";
export type ConnStatus = "CONNECTED" | "EXPIRED" | "ERROR";
export type MatchStrategy = "EMAIL" | "NAME";

export const PROVIDERS: Array<{ id: Provider; name: string }> = [
  { id: "QBO", name: "QuickBooks Online" },
  { id: "XERO", name: "Xero" },
];

export function providerName(p: Provider): string {
  return PROVIDERS.find((x) => x.id === p)?.name ?? p;
}

// --- retry / backoff ---------------------------------------------------------

/**
 * Max attempts before a sync is parked as FAILED (surfaced with a Retry button).
 * A merchant setting-worthy constant, documented in /docs/accounting-sync.md —
 * not a magic number buried in a handler.
 */
export const SYNC_MAX_ATTEMPTS = 5;

/** Exponential backoff (capped) for the Nth attempt (1-based). Pure. */
export function backoffDelayMs(attempts: number, baseMs = 30_000, capMs = 3_600_000): number {
  if (attempts <= 0) return 0;
  const delay = baseMs * 2 ** (attempts - 1);
  return Math.min(delay, capMs);
}

/** Is a PENDING log with this many prior attempts eligible to run now? */
export function shouldRetry(attempts: number, maxAttempts = SYNC_MAX_ATTEMPTS): boolean {
  return attempts < maxAttempts;
}

/**
 * Status a log takes after an attempt. A success is SYNCED; a failure stays
 * PENDING while attempts remain (so the next cron pass retries with backoff) and
 * is parked FAILED once they're exhausted. Pure — the whole retry policy.
 */
export function nextStatusAfterAttempt(
  ok: boolean,
  attemptsAfter: number,
  maxAttempts = SYNC_MAX_ATTEMPTS,
): SyncStatus {
  if (ok) return "SYNCED";
  return attemptsAfter >= maxAttempts ? "FAILED" : "PENDING";
}

// --- idempotency -------------------------------------------------------------

/** Dedupe key for a sync target — mirrors the DB unique (shop,provider,entity,localId). */
export function dedupeKey(provider: Provider, entity: SyncEntity, localId: string): string {
  return `${provider}:${entity}:${localId}`;
}

// --- field mapping -----------------------------------------------------------

export type TaxCodeMap = Record<string, string>;
export type AccountMap = Record<string, string>;

/** Map a Mannon tax class to a provider tax code; falls back to the "default" entry. */
export function mapTaxCode(taxClass: string | null | undefined, map: TaxCodeMap): string | null {
  if (taxClass && map[taxClass]) return map[taxClass];
  return map.default ?? null;
}

/** The default income/sales account id from the account map, if configured. */
export function incomeAccount(map: AccountMap): string | null {
  return map.income ?? null;
}

/**
 * Which value identifies the provider customer for a match/create. EMAIL is the
 * safest (stable, unique); NAME is the fallback when the buyer has no email. Pure.
 */
export function customerRef(
  strategy: MatchStrategy,
  buyer: { email?: string | null; name?: string | null },
): { by: MatchStrategy; value: string } | null {
  const email = buyer.email?.trim();
  const name = buyer.name?.trim();
  if (strategy === "EMAIL" && email) return { by: "EMAIL", value: email };
  if (strategy === "NAME" && name) return { by: "NAME", value: name };
  // Fall back to whichever we have so a sync isn't blocked on a missing field.
  if (email) return { by: "EMAIL", value: email };
  if (name) return { by: "NAME", value: name };
  return null;
}

// --- normalized invoice DTO (what a provider client receives) ----------------

export interface NormalizedInvoiceLine {
  description: string;
  quantity: number;
  unitAmount: string;
  taxCode: string | null;
  accountId: string | null;
}

export interface NormalizedInvoice {
  localId: string;
  reference: string;
  currency: string;
  issuedAt: string; // ISO date
  dueDate: string; // ISO date
  customer: { by: MatchStrategy; value: string; companyName: string };
  lines: NormalizedInvoiceLine[];
  total: string;
  /** Payment to attach when the invoice is already paid (net-terms settled). */
  payment: { amount: string; paidAt: string } | null;
}

export interface RawInvoice {
  id: string;
  amount: string;
  currency: string;
  issuedAt: Date;
  dueDate: Date;
  paidAt: Date | null;
  status: string;
  taxClass?: string | null;
  companyName: string;
  buyer: { email?: string | null; name?: string | null };
}

/**
 * Build the provider-agnostic invoice a client will translate to QBO/Xero JSON.
 * We never recompute money — `amount` is the snapshot Shopify already produced
 * (guardrail #1); this only reshapes + maps codes. Returns null when there's no
 * customer to attach it to (caller records a clear failure).
 */
export function normalizeInvoice(
  raw: RawInvoice,
  map: { taxCodeMap: TaxCodeMap; accountMap: AccountMap; customerMatchStrategy: MatchStrategy },
): NormalizedInvoice | null {
  const customer = customerRef(map.customerMatchStrategy, raw.buyer);
  if (!customer) return null;
  const taxCode = mapTaxCode(raw.taxClass, map.taxCodeMap);
  const accountId = incomeAccount(map.accountMap);
  return {
    localId: raw.id,
    reference: `MANNON-${raw.id.slice(-8).toUpperCase()}`,
    currency: raw.currency,
    issuedAt: raw.issuedAt.toISOString(),
    dueDate: raw.dueDate.toISOString(),
    customer: { ...customer, companyName: raw.companyName },
    lines: [
      {
        description: `Wholesale order ${raw.companyName}`,
        quantity: 1,
        unitAmount: raw.amount,
        taxCode,
        accountId,
      },
    ],
    total: raw.amount,
    payment:
      raw.status === "PAID" && raw.paidAt
        ? { amount: raw.amount, paidAt: raw.paidAt.toISOString() }
        : null,
  };
}

// --- connection health -------------------------------------------------------

/** Derive a connection's health from its stored status + token expiry. Pure. */
export function connectionHealth(
  stored: ConnStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): ConnStatus {
  if (stored === "ERROR") return "ERROR";
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return stored;
}

// --- failure digest ----------------------------------------------------------

export interface DigestSummary {
  failed: number;
  pending: number;
  synced: number;
  needsAttention: boolean;
}

/** Summarize sync logs for the merchant failure digest. Pure. */
export function summarizeForDigest(
  logs: Array<{ status: SyncStatus }>,
): DigestSummary {
  let failed = 0;
  let pending = 0;
  let synced = 0;
  for (const l of logs) {
    if (l.status === "FAILED") failed++;
    else if (l.status === "PENDING") pending++;
    else if (l.status === "SYNCED") synced++;
  }
  return { failed, pending, synced, needsAttention: failed > 0 };
}
