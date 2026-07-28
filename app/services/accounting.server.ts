import type { AccountingProvider, CustomerMatchStrategy, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { encryptSecret, decryptSecret } from "../lib/crypto.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import {
  type Provider,
  type NormalizedInvoice,
  type MatchStrategy,
  type TaxCodeMap,
  type AccountMap,
  normalizeInvoice,
  nextStatusAfterAttempt,
  shouldRetry,
  backoffDelayMs,
  summarizeForDigest,
  providerName,
  PROVIDERS,
} from "../lib/accounting";

/**
 * F10 — Accounting Sync service (QuickBooks Online + Xero). Growth-only, dark-
 * launched behind MANNON_FF_ACCOUNTING_SYNC. Pushes Mannon net-terms invoices
 * (and their payments) into the merchant's accounting provider with zero
 * re-keying. Tokens are encrypted at rest (crypto.server) and never logged; a
 * failed sync never blocks the Shopify order (best-effort, retried by cron).
 *
 * The provider HTTP sits behind AccountingProviderClient so the sync engine is
 * testable with a fake client (no network). Real QBO/Xero endpoints are wired in
 * makeProviderClient(); confirm sandbox base URLs + payload shapes against each
 * provider's API before go-live (see /docs/accounting-sync.md).
 */

export const ACCOUNTING_ENABLED = () => process.env.MANNON_FF_ACCOUNTING_SYNC === "true";

// --- provider client interface ----------------------------------------------

export interface ProviderCustomer {
  remoteId: string;
}

export interface AccountingProviderClient {
  /** Find an existing provider customer or create one; returns its remote id. */
  findOrCreateCustomer(customer: NormalizedInvoice["customer"]): Promise<ProviderCustomer>;
  /** Create the invoice against the customer; returns the remote invoice id. */
  createInvoice(invoice: NormalizedInvoice, customerRemoteId: string): Promise<{ remoteId: string }>;
  /** Attach a payment to an already-created invoice (net-terms settled). */
  createPayment(invoiceRemoteId: string, payment: NonNullable<NormalizedInvoice["payment"]>): Promise<void>;
}

export type ClientFactory = (
  provider: Provider,
  conn: { accessToken: string; realmId: string | null; tenantId: string | null; sandbox: boolean },
) => AccountingProviderClient;

// --- OAuth config ------------------------------------------------------------

interface ProviderOAuth {
  authorizeUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
}

/** OAuth endpoints/scopes per provider. Client id/secret come from env (never pasted). */
export function oauthConfig(provider: Provider): ProviderOAuth {
  if (provider === "QBO") {
    return {
      authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
      scope: "com.intuit.quickbooks.accounting",
      clientId: process.env.QBO_CLIENT_ID,
      clientSecret: process.env.QBO_CLIENT_SECRET,
    };
  }
  return {
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    scope: "accounting.transactions accounting.contacts offline_access",
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
  };
}

// The OAuth `state` carries the shop identity (signed) so the public callback —
// which has no Shopify session — can trust which shop it's completing, and can't
// be forged. Signed with the app secret; 10-minute freshness window.
const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): string {
  return process.env.SHOPIFY_API_SECRET ?? "dev-secret";
}

export function signState(shopDomain: string, provider: Provider, issuedAt = Date.now()): string {
  const { computeHmac } = require("../lib/hmac.server") as typeof import("../lib/hmac.server");
  const payload = `${shopDomain}|${provider}|${issuedAt}`;
  const sig = computeHmac(payload, stateSecret());
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyState(
  state: string,
  now = Date.now(),
): { shopDomain: string; provider: Provider } | null {
  const { isValidHmac } = require("../lib/hmac.server") as typeof import("../lib/hmac.server");
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!isValidHmac(payload, sig, stateSecret())) return null;
  const [shopDomain, provider, issuedAt] = payload.split("|");
  if (!shopDomain || (provider !== "QBO" && provider !== "XERO")) return null;
  if (now - Number(issuedAt) > STATE_TTL_MS) return null;
  return { shopDomain, provider: provider as Provider };
}

export function redirectUri(provider: Provider, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/accounting/callback/${provider.toLowerCase()}`;
}

/** Build the provider authorize URL. `state` carries the signed shop identity. */
export function buildAuthorizeUrl(provider: Provider, baseUrl: string, state: string): string {
  const cfg = oauthConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId ?? "",
    response_type: "code",
    scope: cfg.scope,
    redirect_uri: redirectUri(provider, baseUrl),
    state,
  });
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

function tokenEndpoint(provider: Provider): string {
  return provider === "QBO"
    ? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
    : "https://identity.xero.com/connect/token";
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  realmId?: string | null;
  tenantId?: string | null;
  expiresAt: Date | null;
}

/**
 * Exchange an OAuth authorization code for tokens. QBO returns the company id as
 * `realmId` on the callback query (passed in); Xero's tenant id is fetched from
 * its connections endpoint. Confirm payloads against each provider before
 * go-live. Never logs the response body (contains secrets).
 */
export async function exchangeCodeForTokens(
  provider: Provider,
  code: string,
  baseUrl: string,
  realmId?: string | null,
  now: Date = new Date(),
): Promise<TokenResult> {
  const cfg = oauthConfig(provider);
  const basic = Buffer.from(`${cfg.clientId ?? ""}:${cfg.clientSecret ?? ""}`).toString("base64");
  const res = await fetch(tokenEndpoint(provider), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(provider, baseUrl),
    }).toString(),
  });
  if (!res.ok) throw new Error(`${provider} token exchange failed (${res.status})`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };
  const expiresAt = json.expires_in ? new Date(now.getTime() + json.expires_in * 1000) : null;

  let tenantId: string | null = null;
  if (provider === "XERO") {
    try {
      const conns = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${json.access_token}`, Accept: "application/json" },
      });
      if (conns.ok) {
        const list = (await conns.json()) as Array<{ tenantId?: string }>;
        tenantId = list[0]?.tenantId ?? null;
      }
    } catch {
      /* tenant can be re-fetched later; connection still stored */
    }
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    realmId: realmId ?? null,
    tenantId,
    expiresAt,
  };
}

// --- connections + mapping ---------------------------------------------------

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

export interface ConnectionView {
  provider: Provider;
  status: string;
  sandbox: boolean;
  realmId: string | null;
  tenantId: string | null;
  connectedAt: Date;
  expiresAt: Date | null;
}

export async function listConnections(shopDomain: string): Promise<ConnectionView[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.accountingConnection.findMany({ where: { shopId } });
  return rows.map((r) => ({
    provider: r.provider as Provider,
    status: r.status,
    sandbox: r.sandbox,
    realmId: r.realmId,
    tenantId: r.tenantId,
    connectedAt: r.connectedAt,
    expiresAt: r.expiresAt,
  }));
}

export interface SaveConnectionInput {
  shopDomain: string;
  provider: Provider;
  accessToken: string;
  refreshToken: string;
  realmId?: string | null;
  tenantId?: string | null;
  expiresAt?: Date | null;
  sandbox?: boolean;
}

/** Store (or refresh) a connection with tokens encrypted at rest; logs connect. */
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  const shopId = await shopIdFor(input.shopDomain);
  if (!shopId) throw new Error("Unknown shop");
  const data = {
    accessToken: encryptSecret(input.accessToken),
    refreshToken: encryptSecret(input.refreshToken),
    realmId: input.realmId ?? null,
    tenantId: input.tenantId ?? null,
    expiresAt: input.expiresAt ?? null,
    sandbox: input.sandbox ?? false,
    status: "CONNECTED" as const,
  };
  const existing = await prisma.accountingConnection.findUnique({
    where: { shopId_provider: { shopId, provider: input.provider as AccountingProvider } },
    select: { id: true },
  });
  await prisma.accountingConnection.upsert({
    where: { shopId_provider: { shopId, provider: input.provider as AccountingProvider } },
    create: { shopId, provider: input.provider as AccountingProvider, ...data },
    update: data,
  });
  // Only announce a brand-new connection (a silent token refresh isn't news).
  if (!existing) {
    await appendEvent({
      shopId,
      type: "ACCOUNTING_CONNECTED",
      entityType: "AccountingConnection",
      entityId: input.provider,
      payload: { provider: input.provider, sandbox: data.sandbox },
    });
  }
}

export async function disconnect(shopDomain: string, provider: Provider): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.accountingConnection.deleteMany({
    where: { shopId, provider: provider as AccountingProvider },
  });
}

export interface MapView {
  taxCodeMap: TaxCodeMap;
  accountMap: AccountMap;
  customerMatchStrategy: MatchStrategy;
}

export async function getMap(shopDomain: string): Promise<MapView> {
  const shopId = await shopIdFor(shopDomain);
  const empty: MapView = { taxCodeMap: {}, accountMap: {}, customerMatchStrategy: "EMAIL" };
  if (!shopId) return empty;
  const row = await prisma.accountingMap.findUnique({ where: { shopId } });
  if (!row) return empty;
  return {
    taxCodeMap: (row.taxCodeMap ?? {}) as TaxCodeMap,
    accountMap: (row.accountMap ?? {}) as AccountMap,
    customerMatchStrategy: row.customerMatchStrategy as MatchStrategy,
  };
}

export async function saveMap(shopDomain: string, map: MapView): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new Error("Unknown shop");
  const data = {
    taxCodeMap: map.taxCodeMap as Prisma.InputJsonValue,
    accountMap: map.accountMap as Prisma.InputJsonValue,
    customerMatchStrategy: map.customerMatchStrategy as CustomerMatchStrategy,
  };
  await prisma.accountingMap.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });
}

// --- enqueue -----------------------------------------------------------------

/**
 * Queue an invoice for sync to every connected provider. Idempotent: the DB
 * unique (shop,provider,entity,localId) means a retry/double-checkout can't
 * enqueue twice. Best-effort — never throws into the order flow.
 */
export async function enqueueInvoiceSync(shopId: string, invoiceId: string): Promise<void> {
  if (!ACCOUNTING_ENABLED()) return;
  try {
    const conns = await prisma.accountingConnection.findMany({
      where: { shopId, status: { not: "ERROR" } },
      select: { provider: true },
    });
    for (const c of conns) {
      await prisma.accountingSyncLog.upsert({
        where: {
          shopId_provider_entity_localId: {
            shopId,
            provider: c.provider,
            entity: "INVOICE",
            localId: invoiceId,
          },
        },
        create: { shopId, provider: c.provider, entity: "INVOICE", localId: invoiceId, status: "PENDING" },
        update: {}, // already queued/synced — leave it (idempotent, never double-post)
      });
    }
  } catch (error) {
    captureException(error);
  }
}

// --- sync engine -------------------------------------------------------------

async function loadInvoiceForSync(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      company: {
        select: {
          name: true,
          buyers: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { email: true, name: true },
          },
        },
      },
    },
  });
  if (!inv) return null;
  const buyer = inv.company.buyers[0] ?? { email: null, name: null };
  return {
    id: inv.id,
    amount: inv.amount.toString(),
    currency: inv.currency,
    issuedAt: inv.issuedAt,
    dueDate: inv.dueDate,
    paidAt: inv.paidAt,
    status: inv.status,
    taxClass: null as string | null,
    companyName: inv.company.name,
    buyer: { email: buyer.email, name: buyer.name },
  };
}

/** Decrypt a connection's access token for use in transit (never logged). */
export function decryptAccessToken(encrypted: string): string {
  return decryptSecret(encrypted);
}

export interface SyncSummary {
  processed: number;
  synced: number;
  failed: number;
  pending: number;
}

/**
 * Process due PENDING sync logs for a shop. Injectable client factory keeps the
 * engine testable without network. Each log: skip if backoff not elapsed, else
 * attempt once, bump `attempts`, and set the next status via the pure retry
 * policy. A failure is captured on the log — it never throws upward, so the
 * cron pass always completes.
 */
export async function runSyncForShop(
  shopDomain: string,
  clientFactory: ClientFactory,
  now: Date = new Date(),
): Promise<SyncSummary> {
  const summary: SyncSummary = { processed: 0, synced: 0, failed: 0, pending: 0 };
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return summary;

  const map = await getMap(shopDomain);
  const logs = await prisma.accountingSyncLog.findMany({
    where: { shopId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  for (const log of logs) {
    if (!shouldRetry(log.attempts)) continue;
    // Respect backoff: don't re-attempt before the delay from the last try elapses.
    if (log.attempts > 0) {
      const readyAt = log.updatedAt.getTime() + backoffDelayMs(log.attempts);
      if (readyAt > now.getTime()) continue;
    }

    const conn = await prisma.accountingConnection.findUnique({
      where: { shopId_provider: { shopId, provider: log.provider } },
    });
    summary.processed++;
    const attemptsAfter = log.attempts + 1;
    let ok = false;
    let remoteId: string | null = log.remoteId;
    let error: string | null = null;

    try {
      if (!conn) throw new Error("No active connection for this provider");
      if (log.entity !== "INVOICE") throw new Error(`Unsupported entity ${log.entity}`);
      const raw = await loadInvoiceForSync(log.localId);
      if (!raw) throw new Error("Invoice no longer exists");
      const normalized = normalizeInvoice(raw, map);
      if (!normalized) throw new Error("No customer email/name to match — set one on the buyer");

      const client = clientFactory(log.provider as Provider, {
        accessToken: decryptAccessToken(conn.accessToken),
        realmId: conn.realmId,
        tenantId: conn.tenantId,
        sandbox: conn.sandbox,
      });
      const customer = await client.findOrCreateCustomer(normalized.customer);
      const created = await client.createInvoice(normalized, customer.remoteId);
      remoteId = created.remoteId;
      if (normalized.payment) await client.createPayment(created.remoteId, normalized.payment);
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown sync error";
      captureException(err);
    }

    const status = nextStatusAfterAttempt(ok, attemptsAfter);
    await prisma.accountingSyncLog.update({
      where: { id: log.id },
      data: {
        status,
        attempts: attemptsAfter,
        remoteId,
        error: ok ? null : error,
        syncedAt: ok ? now : null,
      },
    });

    if (ok) {
      summary.synced++;
      await appendEvent({
        shopId,
        type: "INVOICE_SYNCED",
        entityType: "Invoice",
        entityId: log.localId,
        payload: { provider: log.provider, remoteId },
      });
    } else if (status === "FAILED") {
      summary.failed++;
    } else {
      summary.pending++;
    }
  }

  return summary;
}

/** Reset a FAILED (or stuck) log to PENDING so the next cron pass retries it. */
export async function retrySyncLog(shopDomain: string, logId: string): Promise<boolean> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return false;
  const res = await prisma.accountingSyncLog.updateMany({
    where: { id: logId, shopId },
    data: { status: "PENDING", attempts: 0, error: null, digested: false },
  });
  return res.count > 0;
}

export interface SyncLogRow {
  id: string;
  provider: Provider;
  entity: string;
  localId: string;
  remoteId: string | null;
  status: string;
  attempts: number;
  error: string | null;
  syncedAt: Date | null;
  createdAt: Date;
}

export async function listSyncLogs(shopDomain: string, take = 100): Promise<SyncLogRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.accountingSyncLog.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider as Provider,
    entity: r.entity,
    localId: r.localId,
    remoteId: r.remoteId,
    status: r.status,
    attempts: r.attempts,
    error: r.error,
    syncedAt: r.syncedAt,
    createdAt: r.createdAt,
  }));
}

/**
 * Email the merchant ONE digest of undigested failures (not per-event spam).
 * Marks the failures digested so they aren't reported again. Returns whether an
 * email was queued.
 */
export async function sendFailureDigest(
  shopDomain: string,
  baseUrl: string,
): Promise<boolean> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return false;
  const failures = await prisma.accountingSyncLog.findMany({
    where: { shopId, status: "FAILED", digested: false },
    select: { id: true, provider: true },
  });
  if (failures.length === 0) return false;

  const summary = summarizeForDigest(failures.map(() => ({ status: "FAILED" as const })));
  const provider = providerName((failures[0].provider as Provider));
  const to = process.env.MANNON_MERCHANT_ALERT_EMAIL;
  if (to) {
    const tpl = renderTemplate(resolveTemplate("accounting_sync_failure", null), {
      failed: String(summary.failed),
      provider,
      shopName: shopDomain,
      syncLogUrl: `${baseUrl.replace(/\/$/, "")}/app/accounting`,
    });
    await sendEmail({ to, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
  }
  await prisma.accountingSyncLog.updateMany({
    where: { id: { in: failures.map((f) => f.id) } },
    data: { digested: true },
  });
  return true;
}

// --- real provider clients ---------------------------------------------------

/**
 * Live QBO/Xero client factory. Kept intentionally small; the sync engine only
 * needs three calls. Sandbox base URLs are used when the connection is in test
 * mode. Confirm exact payload shapes against each provider's current API before
 * go-live (see /docs/accounting-sync.md).
 */
export const makeProviderClient: ClientFactory = (provider, conn) => {
  const authHeader = { Authorization: `Bearer ${conn.accessToken}` };

  if (provider === "QBO") {
    const base = conn.sandbox
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
    const root = `${base}/v3/company/${conn.realmId}`;
    return {
      async findOrCreateCustomer(customer) {
        const res = await fetch(`${root}/customer`, {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ DisplayName: customer.companyName, PrimaryEmailAddr: { Address: customer.value } }),
        });
        if (!res.ok) throw new Error(`QBO customer ${res.status}`);
        const json = (await res.json()) as { Customer?: { Id?: string } };
        return { remoteId: json.Customer?.Id ?? "" };
      },
      async createInvoice(invoice, customerRemoteId) {
        const res = await fetch(`${root}/invoice`, {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            CustomerRef: { value: customerRemoteId },
            DocNumber: invoice.reference,
            Line: invoice.lines.map((l) => ({
              Amount: Number(l.unitAmount) * l.quantity,
              DetailType: "SalesItemLineDetail",
              Description: l.description,
              SalesItemLineDetail: l.accountId ? { ItemRef: { value: l.accountId } } : {},
            })),
          }),
        });
        if (!res.ok) throw new Error(`QBO invoice ${res.status}`);
        const json = (await res.json()) as { Invoice?: { Id?: string } };
        return { remoteId: json.Invoice?.Id ?? "" };
      },
      async createPayment(invoiceRemoteId, payment) {
        const res = await fetch(`${root}/payment`, {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ TotalAmt: Number(payment.amount), Line: [{ Amount: Number(payment.amount), LinkedTxn: [{ TxnId: invoiceRemoteId, TxnType: "Invoice" }] }] }),
        });
        if (!res.ok) throw new Error(`QBO payment ${res.status}`);
      },
    };
  }

  // Xero
  const base = "https://api.xero.com/api.xro/2.0";
  const xeroHeaders = { ...authHeader, "Xero-tenant-id": conn.tenantId ?? "", "Content-Type": "application/json", Accept: "application/json" };
  return {
    async findOrCreateCustomer(customer) {
      const res = await fetch(`${base}/Contacts`, {
        method: "POST",
        headers: xeroHeaders,
        body: JSON.stringify({ Contacts: [{ Name: customer.companyName, EmailAddress: customer.by === "EMAIL" ? customer.value : undefined }] }),
      });
      if (!res.ok) throw new Error(`Xero contact ${res.status}`);
      const json = (await res.json()) as { Contacts?: Array<{ ContactID?: string }> };
      return { remoteId: json.Contacts?.[0]?.ContactID ?? "" };
    },
    async createInvoice(invoice, customerRemoteId) {
      const res = await fetch(`${base}/Invoices`, {
        method: "POST",
        headers: xeroHeaders,
        body: JSON.stringify({
          Invoices: [{
            Type: "ACCREC",
            Contact: { ContactID: customerRemoteId },
            Reference: invoice.reference,
            CurrencyCode: invoice.currency,
            DueDate: invoice.dueDate,
            LineItems: invoice.lines.map((l) => ({
              Description: l.description,
              Quantity: l.quantity,
              UnitAmount: Number(l.unitAmount),
              TaxType: l.taxCode ?? undefined,
              AccountCode: l.accountId ?? undefined,
            })),
          }],
        }),
      });
      if (!res.ok) throw new Error(`Xero invoice ${res.status}`);
      const json = (await res.json()) as { Invoices?: Array<{ InvoiceID?: string }> };
      return { remoteId: json.Invoices?.[0]?.InvoiceID ?? "" };
    },
    async createPayment(invoiceRemoteId, payment) {
      const res = await fetch(`${base}/Payments`, {
        method: "PUT",
        headers: xeroHeaders,
        body: JSON.stringify({ Payments: [{ Invoice: { InvoiceID: invoiceRemoteId }, Amount: Number(payment.amount), Date: payment.paidAt }] }),
      });
      if (!res.ok) throw new Error(`Xero payment ${res.status}`);
    },
  };
};

export { PROVIDERS };
