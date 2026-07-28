import type { ErpKind, StockSource, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { encryptSecret, decryptSecret } from "../lib/crypto.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import {
  parseStockUpdates,
  oversellCheck,
  normalizeOrder,
  nextStatusAfterAttempt,
  shouldRetry,
  backoffDelayMs,
  summarizeForDigest,
  erpKindName,
  type NormalizedOrder,
  type StockUpdate,
} from "../lib/erp";

/**
 * F15 — ERP / Inventory Sync service. Growth-only, dark-launched behind
 * MANNON_FF_ERP_SYNC. Inbound: reconcile ERP stock into a Mannon override cache
 * (the oversell guard reads it). Outbound: export paid/approved orders to the
 * ERP via a connector, idempotent + retried with backoff (mirrors F10).
 *
 * GUARDRAILS: credentials are AES-256-GCM encrypted at rest and never logged; a
 * sync failure never hard-blocks Shopify (best-effort + a loud sync log); and the
 * oversell guard blocks a line before checkout when the ERP says a SKU is short.
 */

export const ERP_ENABLED = () => process.env.MANNON_FF_ERP_SYNC === "true";

export class NotFoundError extends Error {}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

// --- connector interface -----------------------------------------------------

export interface ErpConnector {
  /** Push a normalized order to the ERP; returns its remote id. */
  exportOrder(order: NormalizedOrder): Promise<{ remoteId: string }>;
}

export type ConnectorFactory = (
  kind: ErpKind,
  conn: { endpoint: string | null; secret: string | null; sandbox: boolean; config: Record<string, unknown> },
) => ErpConnector;

/**
 * Live connector factory. WEBHOOK POSTs the payload to the endpoint with the
 * secret as a bearer token. SFTP/NetSuite/custom are stubbed pending a real
 * integration (confirm before go-live) — the export engine is exercised in tests
 * with an injected fake connector.
 */
export const makeConnector: ConnectorFactory = (kind, conn) => {
  if (kind === "WEBHOOK") {
    return {
      async exportOrder(order) {
        if (!conn.endpoint) throw new Error("No webhook endpoint configured");
        const res = await fetch(conn.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(conn.secret ? { Authorization: `Bearer ${conn.secret}` } : {}), "X-Mannon-Sandbox": conn.sandbox ? "1" : "0" },
          body: JSON.stringify({ type: "order.export", order }),
        });
        if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
        const json = (await res.json().catch(() => ({}))) as { id?: string; remoteId?: string };
        return { remoteId: json.remoteId ?? json.id ?? order.reference };
      },
    };
  }
  // SFTP / NETSUITE / CUSTOM — pending a real integration.
  return {
    async exportOrder() {
      throw new Error(`${erpKindName(kind)} export isn't wired for this environment yet`);
    },
  };
};

// --- connection CRUD ---------------------------------------------------------

export interface ConnectionView {
  kind: ErpKind;
  endpoint: string | null;
  sandbox: boolean;
  sourceOfTruth: StockSource;
  status: string;
  hasSecret: boolean;
  lastSyncAt: Date | null;
  config: Record<string, unknown>;
}

export async function getConnection(shopDomain: string): Promise<ConnectionView | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const c = await prisma.erpConnection.findUnique({ where: { shopId } });
  if (!c) return null;
  return {
    kind: c.kind,
    endpoint: c.endpoint,
    sandbox: c.sandbox,
    sourceOfTruth: c.sourceOfTruth,
    status: c.status,
    hasSecret: c.secretEncrypted != null,
    lastSyncAt: c.lastSyncAt,
    config: (c.config ?? {}) as Record<string, unknown>,
  };
}

export interface SaveConnectionInput {
  kind: ErpKind;
  endpoint?: string | null;
  secret?: string | null; // plaintext in transit only; encrypted at rest
  sandbox: boolean;
  sourceOfTruth: StockSource;
  config?: Record<string, unknown>;
}

export async function saveConnection(shopDomain: string, input: SaveConnectionInput): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new NotFoundError("Unknown shop");
  const existing = await prisma.erpConnection.findUnique({ where: { shopId }, select: { id: true, secretEncrypted: true } });

  const data = {
    kind: input.kind,
    endpoint: input.endpoint?.trim() || null,
    sandbox: input.sandbox,
    sourceOfTruth: input.sourceOfTruth,
    status: "CONNECTED" as const,
    config: (input.config ?? {}) as Prisma.InputJsonValue,
    // Only replace the stored secret when a new one is supplied.
    ...(input.secret ? { secretEncrypted: encryptSecret(input.secret) } : {}),
  };

  await prisma.erpConnection.upsert({
    where: { shopId },
    create: { shopId, ...data, secretEncrypted: input.secret ? encryptSecret(input.secret) : null },
    update: data,
  });

  if (!existing) {
    await appendEvent({ shopId, type: "ERP_CONNECTED", entityType: "ErpConnection", entityId: input.kind, payload: { kind: input.kind, sandbox: input.sandbox } });
  }
}

export async function disconnect(shopDomain: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.erpConnection.deleteMany({ where: { shopId } });
}

/** The inbound webhook secret for a shop (decrypted). Used to verify inbound posts. */
export async function getInboundSecret(shopDomain: string): Promise<string | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const c = await prisma.erpConnection.findUnique({ where: { shopId }, select: { secretEncrypted: true } });
  if (!c?.secretEncrypted) return null;
  try {
    return decryptSecret(c.secretEncrypted);
  } catch {
    return null;
  }
}

// --- inbound stock -----------------------------------------------------------

/**
 * Apply an inbound stock payload: upsert the Mannon override cache (source=ERP),
 * log INBOUND_STOCK, and record STOCK_SYNCED. Returns how many variants updated.
 */
export async function applyStockUpdate(shopDomain: string, payload: unknown, now: Date = new Date()): Promise<{ applied: number; errors: string[] }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { applied: 0, errors: ["Unknown shop"] };
  const { updates, errors } = parseStockUpdates(payload);

  for (const u of updates) {
    await prisma.stockOverride.upsert({
      where: { shopId_variantId: { shopId, variantId: u.variantId } },
      create: { shopId, variantId: u.variantId, source: "ERP", qty: u.qty },
      update: { source: "ERP", qty: u.qty },
    });
  }

  if (updates.length > 0) {
    await prisma.erpSyncLog.create({ data: { shopId, direction: "INBOUND_STOCK", entity: "stock", status: "SYNCED", localId: null, error: null } });
    await prisma.erpConnection.updateMany({ where: { shopId }, data: { lastSyncAt: now, status: "CONNECTED" } });
    await appendEvent({ shopId, type: "STOCK_SYNCED", entityType: "Shop", entityId: shopId, payload: { variants: updates.length } });
  }
  return { applied: updates.length, errors };
}

/** Current stock override qty for a variant (or null when we have no ERP signal). */
export async function getStockQty(shopId: string, variantId: string): Promise<number | null> {
  const row = await prisma.stockOverride.findUnique({ where: { shopId_variantId: { shopId, variantId } }, select: { qty: true } });
  return row?.qty ?? null;
}

export interface CartLine {
  variantId: string;
  quantity: number;
  sku?: string | null;
}

/**
 * The oversell guard: block a cart line whose quantity exceeds the ERP-known
 * available stock. Returns the first blocking line's message, or null. No signal
 * for a variant → allowed (never block on missing data). Flag off → allowed.
 */
export async function checkStockForCart(shopDomain: string, lines: CartLine[]): Promise<{ ok: boolean; message?: string }> {
  if (!ERP_ENABLED()) return { ok: true };
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { ok: true };

  const overrides = await prisma.stockOverride.findMany({ where: { shopId, variantId: { in: lines.map((l) => l.variantId) } } });
  const byVariant = new Map(overrides.map((o) => [o.variantId, o.qty]));

  for (const line of lines) {
    const available = byVariant.has(line.variantId) ? byVariant.get(line.variantId)! : null;
    const check = oversellCheck(available, line.quantity);
    if (!check.ok) {
      const { oversellMessage } = await import("../lib/erp");
      return { ok: false, message: oversellMessage(line.sku ?? null, check.available!, check.requested) };
    }
  }
  return { ok: true };
}

// --- outbound order export ---------------------------------------------------

/** Queue an order (accepted quote) for outbound export. Idempotent per (shop, order). */
export async function enqueueOrderExport(shopId: string, quoteId: string): Promise<void> {
  if (!ERP_ENABLED()) return;
  try {
    const conn = await prisma.erpConnection.findUnique({ where: { shopId }, select: { id: true } });
    if (!conn) return; // no ERP connected → nothing to export
    const existing = await prisma.erpSyncLog.findFirst({
      where: { shopId, direction: "OUTBOUND_ORDER", localId: quoteId, status: { in: ["PENDING", "SYNCED"] } },
      select: { id: true },
    });
    if (existing) return; // already queued/exported — never double-post
    await prisma.erpSyncLog.create({ data: { shopId, direction: "OUTBOUND_ORDER", entity: "order", localId: quoteId, status: "PENDING" } });
  } catch (error) {
    captureException(error);
  }
}

async function loadOrderForExport(quoteId: string) {
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      company: { select: { name: true } },
      lines: true,
    },
  });
  if (!q) return null;
  const totals = (q.totalsSnapshot ?? {}) as { total?: string; currencyCode?: string };
  return {
    id: q.id,
    companyName: q.company.name,
    currency: totals.currencyCode ?? "USD",
    total: totals.total ?? "0.00",
    placedAt: q.updatedAt,
    poReference: q.poReference,
    lines: q.lines.map((l) => ({ sku: l.sku, variantId: l.variantId, quantity: l.quantity, price: l.price.toString() })),
  };
}

export interface ExportSummary {
  processed: number;
  synced: number;
  failed: number;
  pending: number;
}

/**
 * Process due PENDING outbound logs for a shop with an injectable connector.
 * Each: skip if backoff not elapsed, attempt once, bump attempts, set status via
 * the shared retry policy. A failure is captured on the log — never thrown up, so
 * a Shopify order is never hard-blocked (guardrail).
 */
export async function runExportForShop(shopDomain: string, connectorFactory: ConnectorFactory, now: Date = new Date()): Promise<ExportSummary> {
  const summary: ExportSummary = { processed: 0, synced: 0, failed: 0, pending: 0 };
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return summary;
  const conn = await prisma.erpConnection.findUnique({ where: { shopId } });
  if (!conn) return summary;

  const logs = await prisma.erpSyncLog.findMany({ where: { shopId, direction: "OUTBOUND_ORDER", status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 200 });

  for (const log of logs) {
    if (!shouldRetry(log.attempts)) continue;
    if (log.attempts > 0 && log.updatedAt.getTime() + backoffDelayMs(log.attempts) > now.getTime()) continue;

    summary.processed++;
    const attemptsAfter = log.attempts + 1;
    let ok = false;
    let remoteId: string | null = log.remoteId;
    let error: string | null = null;

    try {
      if (!log.localId) throw new Error("Missing order id");
      const raw = await loadOrderForExport(log.localId);
      if (!raw) throw new Error("Order no longer exists");
      const connector = connectorFactory(conn.kind, {
        endpoint: conn.endpoint,
        secret: conn.secretEncrypted ? decryptSecret(conn.secretEncrypted) : null,
        sandbox: conn.sandbox,
        config: (conn.config ?? {}) as Record<string, unknown>,
      });
      const result = await connector.exportOrder(normalizeOrder(raw));
      remoteId = result.remoteId;
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown export error";
      captureException(err);
    }

    const status = nextStatusAfterAttempt(ok, attemptsAfter);
    await prisma.erpSyncLog.update({ where: { id: log.id }, data: { status, attempts: attemptsAfter, remoteId, error: ok ? null : error } });
    if (ok) {
      summary.synced++;
      await prisma.erpConnection.update({ where: { shopId }, data: { lastSyncAt: now } });
      await appendEvent({ shopId, type: "ORDER_EXPORTED", entityType: "Quote", entityId: log.localId!, payload: { remoteId } });
    } else if (status === "FAILED") {
      summary.failed++;
      await prisma.erpConnection.updateMany({ where: { shopId }, data: { status: "ERROR" } });
    } else {
      summary.pending++;
    }
  }
  return summary;
}

export async function retrySyncLog(shopDomain: string, logId: string): Promise<boolean> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return false;
  const res = await prisma.erpSyncLog.updateMany({ where: { id: logId, shopId }, data: { status: "PENDING", attempts: 0, error: null, digested: false } });
  return res.count > 0;
}

export interface SyncLogRow {
  id: string;
  direction: string;
  entity: string;
  localId: string | null;
  remoteId: string | null;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
}

export async function listSyncLogs(shopDomain: string, take = 100): Promise<SyncLogRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.erpSyncLog.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, direction: r.direction, entity: r.entity, localId: r.localId, remoteId: r.remoteId, status: r.status, attempts: r.attempts, error: r.error, createdAt: r.createdAt }));
}

/** Email the merchant ONE digest of undigested failures (not per-event spam). */
export async function sendFailureDigest(shopDomain: string): Promise<boolean> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return false;
  const failures = await prisma.erpSyncLog.findMany({ where: { shopId, status: "FAILED", digested: false }, select: { id: true } });
  if (failures.length === 0) return false;
  const summary = summarizeForDigest(failures.map(() => ({ status: "FAILED" as const })));
  const to = process.env.MANNON_MERCHANT_ALERT_EMAIL;
  if (to) {
    const tpl = renderTemplate(resolveTemplate("erp_sync_failure", null), { failed: String(summary.failed), shopName: shopDomain, syncLogUrl: `${(process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "")}/app/erp` });
    await sendEmail({ to, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
  }
  await prisma.erpSyncLog.updateMany({ where: { id: { in: failures.map((f) => f.id) } }, data: { digested: true } });
  return true;
}
