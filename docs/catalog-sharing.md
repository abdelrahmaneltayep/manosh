# Feature 19 — Catalog Sharing & B2B Discovery (Faire-Style)

Publish a chosen **F11 custom catalog** as a branded public wholesale page so new
buyers discover you and request access. A network/growth play. **Growth-only**,
dark-launched behind `MANNON_FF_CATALOG_SHARE`. When the flag is off, every route
below 404s.

## Surfaces

| Route | Who | Purpose |
|---|---|---|
| `/app/catalog-sharing` | Merchant (embedded) | Publish catalogs, set price/visibility, work the access-request queue |
| `/catalog/:shop/:slug` | Public | SEO-friendly branded catalog page + "Request wholesale access" |
| `/discover` | Public | Opt-in directory of **listed + live** catalogs |

## Data model (migration `f19_catalog_sharing`)

- `PublicCatalog { id, shop, catalog → Catalog(F11), slug, title, visibility(LINK|LISTED), showPrices(HIDDEN|AFTER_APPROVAL|PUBLIC), status(DRAFT|LIVE) }` — `@@unique([shopId, slug])`.
- `CatalogLead { id, publicCatalog, email, companyName?, message?, status(NEW|APPROVED|DECLINED), createdAt }`.
- `EventType` += `PUBLIC_CATALOG_PUBLISHED`, `CATALOG_LEAD_CREATED`.

## Price-protection guarantee (the guardrail)

Two independent protections, both enforced server-side:

1. **Hidden SKUs never leak.** The public page resolves products through the **same
   F11 visibility** (`buildVisibility` + `filterVisible`) used by the portal, order
   pad, and quote builder. A product that isn't in the chosen catalog's visible set
   simply isn't in the page's data — not hidden by CSS, absent from the response.
2. **Prices are hidden by default.** `pricesVisibleOnPublicPage(showPrices)` returns
   true **only** for `PUBLIC`. `HIDDEN` and `AFTER_APPROVAL` both keep prices off the
   public page; `AFTER_APPROVAL` prices unlock later, inside the portal, once the
   buyer is approved. `showPrices` defaults to `HIDDEN`.

A private catalog is never publishable by another shop — `createPublicCatalog`
checks the catalog belongs to the requesting shop, and every mutation goes through
`ownedPublicCatalog`.

## Request access → F6 → F11 pipeline

1. A visitor submits the "Request wholesale access" form → `createLead`. It's
   **honeypot-guarded + rate-limited** (both shared with F6); a tripped honeypot
   returns a generic OK so bots learn nothing, and repeat requests from the same
   email dedupe while still `NEW`.
2. The merchant approves the lead → `approveLead`:
   - creates a `WholesaleApplication` and runs F6 **`provisionApproval`** (Company +
     magic-link buyer + default price list),
   - **assigns the published catalog (F11)** to the new company (`assignCatalog`,
     `COMPANY` scope), so the buyer sees their real prices,
   - emails the buyer `catalog_access_approved` with a secure portal link.

Declining sets the lead to `DECLINED`. Both approve and decline are idempotent on
already-decided leads.

## Plan gating

Growth-only. `catalogSharingAllowed(plan)` gates the admin loader/actions and the
publish/discovery paths; Starter sees an upgrade banner
(`CATALOG_SHARE_UPGRADE_MESSAGE`) instead of a hard redirect. Publishing is the
capability — the public page + discovery listing both require a `LIVE` catalog.

## Deploy hand-off

The container can't reach a store, so after merge:

1. Set `MANNON_FF_CATALOG_SHARE=true`; set `MANNON_MERCHANT_ALERT_EMAIL` to receive
   new-lead notices.
2. Run the `f19_catalog_sharing` migration (`prisma migrate deploy`).
3. Smoke-test: publish a catalog with prices hidden → open the public link → confirm
   no prices and no hidden SKUs → request access → the lead appears → **Approve** →
   the buyer gets a link and, in the portal, sees real prices → **Unlist** → the
   public page 404s.
