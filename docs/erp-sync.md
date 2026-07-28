# Feature 15 — ERP / Inventory Sync (Real-Time Stock & Order Export)

Keep stock accurate and export orders to the merchant's ERP/WMS (webhook, SFTP,
NetSuite, or a custom connector). Growth-only, dark-launched behind
`MANNON_FF_ERP_SYNC`. Highest-effort P2 — the enterprise defense.

## Plan availability

Growth only. Starter sees "ERP & inventory sync — upgrade to Growth" plus an
**Enterprise sync add-on — contact us** placeholder (room for a future
Enterprise/Scale tier). Gated by `erpSyncAllowed(plan)` on the settings page,
sync jobs, and the export worker.

## Credential security (guardrail)

ERP credentials (webhook bearer token / SFTP password / inbound secret) are
**AES-256-GCM encrypted at rest** (`ErpConnection.secretEncrypted`, key
`MANNON_ENCRYPTION_KEY` — shared with F10) and **never logged**. Only non-secret
settings (endpoint, field mapping) live in `config`. The sync-log `error` never
contains credentials.

## Inbound stock → oversell guard

1. The ERP POSTs to `/internal/erp/stock` with `x-shop-domain` +
   `x-erp-secret` (the connection's own secret) — body is a JSON array or a
   `variant_id,qty` CSV (`parseStockUpdates`, pure).
2. `applyStockUpdate` upserts the `StockOverride` cache (`source=ERP`), logs
   `INBOUND_STOCK`, and records `STOCK_SYNCED`.
3. **The oversell guard** (`checkStockForCart` → pure `oversellCheck`) blocks any
   quote/order line whose quantity exceeds the ERP-known available stock **before
   checkout** (wired into `submitBuyerQuote`). A variant with **no** stock signal
   is allowed — we never block on missing data.

**Source of truth** (`resolveStock`, pure): when ERP is the source, an inbound ERP
value governs; when Shopify is the source, the ERP value is advisory (cached) but
Shopify's number governs.

## Outbound order export

- On a **placed order** (accepted quote → draft order), `enqueueOrderExport`
  queues an `OUTBOUND_ORDER` log — **idempotent** per (shop, order): an existing
  PENDING/SYNCED log means we never double-post.
- `/internal/cron/erp` (CRON_SECRET) runs `runExportForShop`: normalize the order
  (`normalizeOrder`, pure — money is a snapshot, never recomputed), call the
  connector, record the remote id. Failures bump `attempts` and stay PENDING
  (capped exponential backoff, **shared with F10**) until `SYNC_MAX_ATTEMPTS`, then
  park **FAILED** with a Retry button.
- **A sync failure never hard-blocks Shopify.** The export engine never throws
  upward; the order is placed regardless and the failure surfaces in the sync log
  + a merchant **failure digest** (`erp_sync_failure`, one email per batch).

## Connectors

| Kind | Status |
|---|---|
| Webhook / HTTP | Live — POSTs `{ type, order }` with the secret as a bearer token |
| CSV over SFTP | Stubbed — confirm the transport before go-live |
| NetSuite | Stubbed — connector integration is a follow-up |
| Custom | Stubbed |

The export engine takes an **injectable** `ConnectorFactory`, so it's exercised in
tests with a fake connector (no network).

## Data model (migration `f15_erp_sync`)

- `ErpConnection { kind, endpoint?, config, secretEncrypted?, sandbox, sourceOfTruth, status, lastSyncAt? }` — one per shop.
- `ErpSyncLog { direction, entity, localId?, remoteId?, status, attempts, error?, digested }` — reuses the F10 `SyncStatus` enum.
- `StockOverride { variantId, source, qty }` — unique (shop, variant); the oversell-guard cache.
- Events `ERP_CONNECTED`, `STOCK_SYNCED`, `ORDER_EXPORTED`.

## Ops

- **Sandbox / dry-run** toggle on the connection.
- **Sync-lag alert** (`syncLagExceeded`, 2h default) surfaces a banner when no
  successful sync has landed.
- Field mapping is stored as JSON on `ErpConnection.config`.

## Reconciliation / notes

- Inbound reconciliation targets Mannon's `StockOverride` cache (read by the
  oversell guard, and available to MOQ/F9 + catalogs/F11). Writing back to Shopify
  inventory levels (when ERP is the source) is a documented follow-up (an Admin
  `inventorySetOnHandQuantities` write behind an added scope).
- No new Shopify OAuth scope in this slice. SFTP/NetSuite connectors are stubs
  pending real integrations; confirm payload shapes before go-live.
