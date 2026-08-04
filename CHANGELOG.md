# Changelog

All notable changes to Mannon are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are UTC.

## [Unreleased]

### Added — Feature 25 (PR-9b): branded quote PDF (download + resend)

- **Dependency-free server-side PDF** (`app/lib/pdf.ts`) — a tiny pure PDF writer
  (Helvetica/WinAnsi, no font embedding, no npm dep, no headless browser), so the
  render is deterministic + unit-tested and stays off the LCP path.
- **Branded quote PDF** (`renderQuotePdfBytes` pure + `renderQuotePdf`): brand header
  (F20 portal name + primary colour when customized, else company name), line items
  with unit + line amounts, an **estimated subtotal** with a "tax + final total at
  checkout" note (we never compute tax/totals — guardrail #1), validity, notes.
  White-label removes the Mannon footer (`whiteLabelAllowed`, Growth). Localized
  labels (en/fr/es) render a second locale.
- **Download** `GET /app/quotes/:id.pdf` (generic `quote.pdf` filename) and **resend**
  (`pdf-email` action attaches via new `EmailMessage.attachments` and emails the
  buyer) — both Starter+, both append `QUOTE_PDF_GENERATED` (migration `quote_pdf`).
  Admin gets a Documents card (Download / Email). Docs: `docs/quote-ops.md`.

### Added — Feature 25 (PR-9a): one-click convert quote → draft order → invoice

- **Merchant one-click convert** (`convertQuoteToOrder`) — from an accepted quote
  (or a countered one the buyer agreed to offline), create a native Shopify draft
  order at the buyer's **exact negotiated prices** and email the invoice. Reuses the
  S8 draft-order builder (no second pricing brain); line prices come **verbatim**
  from `Quote.lines` — never re-priced from the live catalog (test-asserted).
- **Order of operations mirrors S8:** Shopify first (`createDraftOrder`), then a
  best-effort invoice send (`sendDraftOrderInvoice` / `draftOrderInvoiceSend`;
  skippable for F13 deposit / pay-by-link / F2 net terms), then flip the quote
  `COUNTERED → ACCEPTED → ORDERED`, set `Quote.convertedOrderId` (migration
  `quote_ops`) + `draftOrderId`, append `QUOTE_CONVERTED`. A Shopify failure never
  strands the quote.
- **Admin** (`/app/quotes/:id`): a **Convert to order & send invoice** action on an
  accepted/countered quote, gated to a paid plan (Starter+); an "Order created"
  banner after. Buyer must be linked to a company location (like S8). Docs:
  `docs/quote-ops.md`.

### Added — Feature 24 (PR-8e): post-submission control + multi-language

- **Post-submission control (§5.4, Starter+).** `QuoteForm` gains `successMode`
  (MESSAGE | REDIRECT) + `successValue` (migration `quote_capture_i18n`, replacing
  PR-8b's `successMessage`). After submit the widget shows a custom thank-you
  message or redirects to a merchant URL. Available on any paid plan
  (`quoteCaptureAllowed`), enforced in `saveForm` + the admin "After submit" card.
- **Multi-language buyer surfaces (§5.5, Growth).** New `translations` JSON on
  `QuoteForm` (`{ locale: { fields: { key: { label?, placeholder?, help? } },
  successValue? } }`). Pure `normalizeTranslations` / `resolveLocale` (base-language
  fallback `fr-CA` → `fr`) / `localizeForm`; `getPublicForm(locale)` localizes the
  form + message; the widget passes the storefront locale (`<html lang>`). A
  Growth-only admin Translations editor manages per-locale overrides; stripped
  below Growth. The quote PDF + buyer emails localize off the same store as they
  land (PDF = PR-9b).
- **Completes F24 §5.6 acceptance:** form builder + conditional logic, price/ATC
  gating with no leaked price, Add-to-Quote + cart→quote, post-submission control,
  localized form. Tests cover localization + the post-submit/translations gates.

### Added — Feature 24 (PR-8d): Add-to-Quote drawer + Convert-Cart-to-Quote

- **Add-to-Quote drawer** — a storefront theme block (`add_to_quote`) lets buyers
  collect products across product/collection pages into a `localStorage` drawer
  (floating "Quote (n)" launcher, quantity steppers, remove) and submit **one
  multi-line quote**.
- **Convert Cart to Quote** — a cart-page block (`cart_to_quote`) reads `/cart.js`
  and drops the cart into the same drawer for the buyer's email, submitting one
  multi-line request (source `CART`).
- **One path, two channels (no second widget).** `createQuoteRequest` now takes a
  `channel`: `WIDGET` (F17, widget flag + merchant toggle) or `CAPTURE` (F24.3,
  `MANNON_FF_QUOTE_CAPTURE` + a paid plan, `quoteCaptureAllowed`). Same anti-spam,
  validation, and emails. New `GET /api/quote-capture-config` returns the on/off for
  the blocks; submissions reuse `/api/quote-request` with `channel: "CAPTURE"`.
- Gate `quoteCaptureAllowed` (Starter+) is pure + tested; `getQuoteCaptureConfig`
  DB-tested. Both blocks fail closed. Docs: `docs/quote-capture.md`.

### Added — Feature 24 (PR-8c): hide price / Add-to-Cart → "Request a Quote"

- **`PriceVisibilityRule` model** (migration `price-visibility`) — hide price and/or
  Add-to-Cart and swap in a Request-a-Quote CTA, scoped by everyone / logged-out /
  customer tag / product / collection (highest-priority match wins, ties broken by
  specificity). Event `PRICE_RULE_UPDATED`.
- **THE INVARIANT (§5.2): a hidden price never leaves the server.** The pure
  evaluator returns a decision of only `{ hidePrice, hideAtc, ctaLabel }` (no price
  by type); `GET /api/price-visibility` returns exactly that, and the storefront
  block renders no price of its own — it only hides the theme's price/ATC elements
  and shows the CTA. A test asserts the decision carries no `price`/`amount` key.
- **Plan gate:** broad scopes (everyone / logged-out) are Starter; targeted scopes
  (tag / product / collection) are Growth (`priceRuleScopeAllowed`) — enforced in
  `savePriceRule` and shown disabled + labeled in the admin scope picker.
- **Admin `/app/price-rules`** (list/create/delete) + **theme app block `price_gate`**
  (async, reads visitor/product context from Liquid, hides configurable selectors,
  fails open). Behind `MANNON_FF_QUOTE_CAPTURE`. Docs: `docs/quote-capture.md`.

### Added — Feature 24 (PR-8b): advanced form builder (conditional logic + success message)

- **Conditional logic** (`showIf`) — a field can show only when an **earlier**
  field's answer equals a value. Lives in the `fields` JSON (no new column);
  `normalizeFields` validates the reference (drops self/unknown/cycle refs),
  `isFieldVisible`/`visibleFields` evaluate it, and `missingRequired` skips hidden
  required fields. The storefront widget renders conditional fields hidden +
  disabled and re-evaluates on every answer change (so they never submit or block).
- **Per-form success message** (`QuoteForm.successMessage`, migration
  `quote_capture_advanced`) — a custom thank-you shown after submit; the widget uses
  it in place of the default text.
- **Growth-gated** (`quoteFormFeatures.conditionalLogic`): the admin shows the
  per-field "Show only if" controls + the success-message field on Growth, disabled +
  upgrade-labeled below; `saveForm` strips `showIf` and nulls `successMessage` below
  Growth server-side. Multiple named forms per surface (Growth, from PR-8a) bind via
  `getPublicForm`. Tests cover conditional rendering, the required-skip, and the gate.

### Added — Feature 24 (PR-8a): Storefront Quote Capture — custom form builder

- **`QuoteForm` model + builder.** A merchant builds an ordered set of storefront
  quote fields (text/number/email/phone/dropdown/checkbox/file/date/product), per
  surface (product/collection/cart/page). Migration `quote-capture`; `formId` added
  to `QuoteRequest` (set at submission) and `Quote` (carried on conversion). Event
  `QUOTE_FORM_UPDATED`; `QUOTE_REQUEST_CREATED` carries `formId`.
- **Pure field schema** (`app/lib/quote-form.ts`): `normalizeFields` (drops unknown
  types, dedupes keys, parses dropdown options), `moveField`, `missingRequired` —
  unit-tested.
- **Admin `/app/quote-forms`** (embedded Polaris): list + create, and a field
  builder (add/reorder/type/required/placeholder/help/options, active toggle,
  surface). Basic builder on every plan; advanced (conditional logic, multiple
  forms) is Growth — enforced in the service (single-form cap below Growth) and
  shown disabled + upgrade-labeled. `quoteFormFeatures` gate in `app/lib/billing.ts`.
- **Storefront render.** The F17 theme app extension now fetches
  `GET /api/quote-form?shop=&surface=` (async, CORS, cached) and renders the active
  form's fields — falling back to its built-in fields when none is configured.
  Submissions carry `formId` + answers through `/api/quote-request`. No LCP impact.
- Dark-launched behind `MANNON_FF_QUOTE_CAPTURE`. Docs: `docs/quote-capture.md`.

### Added — Feature 20: White-Label / Agency Multi-Store Management

- **Agency org dashboard.** New models `Organization`, `OrgStore` (per-store role
  OWNER/MANAGER/VIEWER), `Branding` (migration `f20_white_label`); admin at
  **/app/agency**. An agency links several Mannon stores into one org and sees
  **cross-store rollups** (quotes, orders, revenue) that reuse the F7/dashboard
  metrics. **Growth-only Agency add-on** (`agencyAllowed`/`whiteLabelAllowed`);
  dark-launched behind `MANNON_FF_WHITE_LABEL`.
- **Per-store data isolation (guardrail).** Every rollup metric is queried strictly
  by that store's `shopId` — data never crosses stores. The org is management-only
  metadata; **each store still bills separately** through Shopify (never a billing
  bypass). Linking a store requires it to have installed Mannon **and** be on its
  own Growth plan.
- **Switch without re-login.** Each connected store has an "Open" deep link to its
  Shopify admin — the agency member is already a Shopify staff user, so Mannon rides
  that session (org-scoped navigation, no separate Mannon login). Role-based:
  viewers are read-only; owners/managers link/unlink and edit branding.
- **White-label (buyer-facing only).** `Branding` overrides the portal name, logo,
  and primary/accent colors on the **buyer portal + emails** — the embedded Shopify
  admin always stays Mannon/Polaris. Colors are **AA-contrast-validated**
  (`validateBranding`, `readableTextOn`) before storage; the portal injects them as
  CSS custom properties, and text color on the primary is chosen for legibility.
- **Emails** `org_invite` + `store_linked` (white-label-aware wording). Events
  `ORG_CREATED`, `STORE_LINKED`, `BRANDING_UPDATED`. Isolation + billing model
  documented in `docs/white-label.md`.

### Added — Feature 19: Catalog Sharing & B2B Discovery (Faire-Style)

- **Publish a shareable catalog.** A merchant turns any **F11 custom catalog** into
  a branded public wholesale page (`/catalog/:shop/:slug`) — shareable by link or
  opt-in **listed** in the in-app discovery index (`/discover`). New models
  `PublicCatalog` + `CatalogLead` (migration `f19_catalog_sharing`); admin at
  **/app/catalog-sharing**. **Growth-only** (`catalogSharingAllowed`); Starter sees
  an upgrade CTA. Dark-launched behind `MANNON_FF_CATALOG_SHARE`.
- **Price-protection guarantee.** The public page reads products through the **same
  F11 visibility resolution** as the portal, so a hidden SKU can never leak. Prices
  render **only** when the merchant chose `showPrices = PUBLIC`; `HIDDEN` and
  `AFTER_APPROVAL` keep prices off the public page (documented in
  `docs/catalog-sharing.md`, unit-tested in `pricesVisibleOnPublicPage`).
- **Request access → F6 → F11.** A "Request wholesale access" CTA creates a
  `CatalogLead` (honeypot + rate-limited, shared with F6; generic OK to bots).
  Approving a lead runs the **F6 provisioning pipeline** (Company + magic-link buyer
  + default price list) and **assigns the catalog (F11)** to the new company, so the
  buyer immediately sees their real prices. Emits `PUBLIC_CATALOG_PUBLISHED` and
  `CATALOG_LEAD_CREATED`.
- **Emails.** `catalog_lead_created` (merchant new-lead notice) and
  `catalog_access_approved` (buyer welcome + secure link). Merchant fully controls
  publish / unlist / delete; unlisting takes the public page offline immediately.

### Added — Feature 18: Buyer PWA & One-Tap Reorder (Installable Mobile)

- **Installable buyer app.** The magic-link portal now ships a **web app manifest**
  (`/portal/manifest.webmanifest`, brand tokens, named after the buyer's shop) and a
  **service worker** (`/portal/sw.js`, scope `/portal/`) so repeat buyers add the
  store to their phone's home screen and reorder in one tap. Pure **progressive
  enhancement** — SW registration is guarded, older browsers keep the plain portal,
  and every PWA route **404s when `MANNON_FF_BUYER_PWA` is off**.
- **Stale-cache guardrail.** The SW cache name is **versioned** (`SW_VERSION`); a
  bump drops old caches on activate. Fetch is **network-first** for portal
  navigations with an offline fallback, and it caches **no PII** beyond what the
  signed-in buyer already sees.
- **One-tap reorder + shortcuts.** `/portal/shortcuts` lets buyers save usual orders
  as **shortcuts** and reorder any in one tap. Reorder runs through **`submitBuyerQuote`**,
  so **MOQ (F9)**, **catalog visibility (F11)**, and **price lists (F3)** all apply;
  a hidden SKU can never be reordered. Emits **`reorder_oneclick`** and **`pwa_installed`** events.
- **Opt-in push (Growth).** Web-Push "time to reorder?" reminders are **strictly
  opt-in** — the permission prompt only appears when the buyer taps "Turn on", never
  on load. Delivery is a pluggable **no-op until VAPID** keys are set. Starter gets
  install + one-tap reorder + **1** saved shortcut; Growth adds push reminders +
  **unlimited** shortcut bundles (`reorderShortcutCap`, `pushRemindersAllowed`).
- **Nudges.** A new `pwa_install_nudge` email ("Reorder from your phone in one tap")
  and the `/internal/cron/reorder-push` worker (CRON_SECRET-guarded) send push
  reminders to subscribed Growth buyers and email install nudges to active buyers
  without a subscription. New models: `PushSubscription`, `ReorderShortcut`. Docs in
  `docs/buyer-pwa.md`.

### Added — Feature 17: Embedded "Request a Quote" Storefront Widget

- **Top of funnel, no code.** A **theme app extension** (`extensions/quote-widget`)
  adds a "Request a Quote" app block to any product or cart page — merchants add it
  from the theme editor. It loads **async** (never blocks the storefront), fetches
  its config, and posts to Mannon's public API.
- **Public API, hardened.** `/api/quote-widget-config` (GET) and `/api/quote-request`
  (POST) are CORS-enabled and public by design. Every submission is **validated +
  escaped** server-side; anti-spam is a **honeypot** (shared with F6) + **rate limit**
  + a **too-fast-submit** timer — spam gets a generic OK so bots learn nothing.
- **One-click convert.** A `QuoteRequest` (NEW) converts to a real **F1 Quote** in
  one click and enters the AI counter-offer flow. Known buyers reuse their company +
  price list; unknown leads get a lightweight "lead" company (synthetic Shopify
  company id, reconciled on first order). Lines resolve against the buyer's **F11
  visible** catalog — a hidden SKU can never be quoted.
- **Gated mode (Growth).** Restrict the button to already-approved (F6) wholesale
  buyers; PDP form is on both plans, cart-level + custom fields + auto-prefill are
  Growth (`quoteWidgetFeatures`).
- **Plan gating.** Both plans (partial by capability). Event `QUOTE_REQUEST_CREATED`.
  New editable templates: new-request notice (merchant) + acknowledgement (visitor).
  Dark-launched behind `MANNON_FF_QUOTE_WIDGET` **and** a per-shop enable toggle.
  Migration `f17_quote_widget`. Recommended high-activation onboarding nudge; the
  storefront hook is promoted to **reel beat 1**. See `docs/quote-widget.md`.

### Added — Feature 16: Multi-Currency & Multi-Language (GCC-First)

- **Their language, their currency.** Buyers see the portal in their locale
  (**Arabic = full RTL**, not just translated text — the shell mirrors via `dir`)
  and prices in their currency. Resolution: member > company > store default.
  Locale switch persists (member `LocalePreference`) and drives localized emails.
- **FX locked per quote (guardrail).** A quote **locks its display currency + rate
  at issue** (`Quote.displayCurrency` / `displayRate`, via pure `lockFx`), so a
  counter-offer never drifts with FX; invoices show the locked rate. Currencies are
  **never mixed** within a quote (`assertSingleCurrency`), and everything **falls
  back cleanly** to the store currency when no rate exists.
- **Contract pricing.** `CurrencyRate` holds Shopify-Markets or merchant-set fixed
  rates; Growth adds **per-currency price-list overrides** (exact prices, no FX) +
  contract rates + custom translations. Mannon never settles money — conversion is
  presentation of an agreed price (guardrail #1).
- **Localized emails.** `resolveTemplate(key, overrides, locale)` layers shop
  override > locale translation > **EN fallback**, so every email always resolves
  (Arabic translations for the core buyer templates; regression-tested across all
  templates × locales).
- **Plan gating (partial).** Starter = store default + **1 extra currency**, EN +
  AR; Growth = unlimited currencies + all locales + per-currency overrides + fixed
  contract rates (`PLAN_LIMITS.extraCurrencyCap` / `localeCap`,
  `contractRatesAllowed`). Merchant settings at `/app/i18n`; number/date/money via
  `Intl`. Event `LOCALE_CHANGED`. Dark-launched behind `MANNON_FF_I18N`. Migration
  `f16_multi_currency_language`. See `docs/i18n.md`.

### Added — Feature 15: ERP / Inventory Sync — Real-Time Stock & Order Export (Growth)

- **Stock in.** An ERP posts stock to `/internal/erp/stock` (per-connection secret,
  JSON or `variant_id,qty` CSV) → Mannon's `StockOverride` cache. The
  **oversell guard** (`checkStockForCart`, pure `oversellCheck`) then blocks any
  quote/order line whose quantity exceeds ERP-known stock **before checkout** — no
  signal for a variant means allowed (never block on missing data).
  **Source-of-truth** is configurable (Shopify / ERP).
- **Orders out.** A placed order (accepted quote) queues for outbound export
  (idempotent per order — never double-posts), exported by `/internal/cron/erp`
  (CRON_SECRET) with capped exponential backoff, parked **FAILED** with a **Retry**
  button after the ceiling. **A sync failure never hard-blocks Shopify** — it
  surfaces loudly in a two-way sync log. Connectors: webhook (live), SFTP /
  NetSuite / custom (stubbed pending integration; the engine is tested via an
  injected fake connector).
- **Security + ops.** ERP credentials are **AES-256-GCM encrypted at rest**
  (`MANNON_ENCRYPTION_KEY`, shared with F10) and never logged. Sandbox/dry-run
  mode, a field-mapping (JSON) UI, a **sync-lag** alert (`syncLagExceeded`), and a
  merchant **failure digest** (`erp_sync_failure`, not per-event spam). Retry /
  backoff / digest helpers are shared with F10.
- **Plan gating.** Growth-only (`erpSyncAllowed`); Starter sees "ERP & inventory
  sync — upgrade to Growth" plus an **Enterprise sync add-on — contact us**
  placeholder. Events `ERP_CONNECTED`, `STOCK_SYNCED`, `ORDER_EXPORTED`.
  Dark-launched behind `MANNON_FF_ERP_SYNC`. Migration `f15_erp_sync` (reuses the
  F10 `SyncStatus` enum). Optional onboarding nudge. See `docs/erp-sync.md`.

### Added — Feature 14: Tax Exemption & VAT/GST Handling

- **Right tax, correct invoices.** Buyers submit a tax ID and/or an exemption
  certificate from their portal; the merchant reviews and verifies. A
  **verified-exempt** buyer gets tax removed at checkout — Mannon sets the draft
  order's `taxExempt` flag and **Shopify zeroes the tax** (guardrail #1: we never
  compute tax). Verified-taxable buyers get Shopify's correct VAT lines plus a
  **compliant sequential invoice number** (Growth).
- **Default-taxed until verified.** The `resolveTaxTreatment` decision (pure,
  unit-tested) never exempts an unverified or rejected profile — an upload never
  auto-exempts. Region `exemptByDefault` is an explicit merchant policy.
- **Certificates stored privately.** Uploaded certificates live in private storage
  (DB bytes, never a public URL) and download **only** through an authenticated
  admin route. Time-limited certs get expiry reminders
  (`/internal/cron/tax-reminders`, idempotent).
- **ID validation** (Growth): format checks for EU VIES-style + **KSA 15-digit**
  VAT, India GSTIN, ABN (checksum), and EIN.
- **Plan gating (partial).** Both plans get a single default rate + a manual
  per-company exempt toggle; Growth adds **per-region rules**, the certificate +
  verification workflow, ID validation, and compliant invoice numbering
  (`taxRegionsAllowed` / `taxCertWorkflowAllowed` / `compliantInvoiceNumbering`).
  Event `TAX_PROFILE_VERIFIED`. New templates: documents received / verified /
  rejected / expiring. Dark-launched behind `MANNON_FF_TAX_VAT`. Migration
  `f14_tax_vat`. Recommended onboarding nudge. See `docs/tax-vat.md`.

### Added — Feature 13: Flexible Payments — Deposits, Partial Pay & Pay-by-Link (Growth)

- **Beyond net terms.** On an accepted order the merchant picks **deposit +
  balance**, an **installment schedule**, or a one-off **pay-by-link**. Amounts are
  **server-authoritative** — computed in `app/lib/payments.ts` from the order's
  stored totals snapshot in integer cents, so deposit + installments always sum to
  the exact total (rounding remainder lands on the last line).
- **Pay-by-link.** A tokenized, single-use, expiring link for a specific amount.
  Only the token **hash** is stored (guardrail #7); no amount/PII is ever put in
  the URL beyond the opaque token. The public `/pay/:token` page shows the amount
  and hands off to Shopify checkout.
- **No card data — ever.** All capture runs through Shopify checkout / draft
  orders; Mannon never stores or sees a card. Documented in
  `docs/flexible-payments.md`.
- **Chases itself + reconciles.** `/internal/cron/payment-reminders` (CRON_SECRET)
  flips overdue installments and sends due/overdue reminders (idempotent per
  installment+stage, reusing the F8 mailer conventions). A completed plan marks the
  net-terms invoice paid and (if F10 is on) triggers an accounting sync. Merchant
  **overdue filter** on `/app/payments`.
- **Plan gating.** Growth-only (`flexPayAllowed`); Starter sees "Deposits & payment
  plans — upgrade to Growth." New Shop setting `defaultDepositPct` (optional
  onboarding). Events `PAYMENT_PLAN_CREATED`, `INSTALLMENT_PAID`, `PAYLINK_PAID`.
  New templates: deposit received / installment due / installment overdue /
  pay-link. Dark-launched behind `MANNON_FF_FLEX_PAY`. Migration
  `f13_flexible_payments`.

### Added — Feature 12: Sales-Rep Portal (Order-on-Behalf & Assigned Accounts) (Growth)

- **Reps sell through Mannon.** A `SalesRep` signs in via the same passwordless
  magic-link mechanism as buyers (token hashed at rest) to a scoped `/rep` portal
  that shows **only** their assigned companies (`RepAssignment`). Strict isolation:
  every read is scoped, and `getRepCompany` returns null (→ 404) for an unassigned
  company (`repCanAccessCompany` is the single source of truth).
- **Order on behalf.** A rep picks a buyer, enters an impersonation context
  (clearly banner-marked "Ordering on behalf of {buyer} · {company}"), and places
  a quote/order that stays the buyer's but is attributed to the rep
  (`Quote.placedByRepId`). Buyer limits still apply (F9 MOQ, F5 approvals, F3
  price list, F11 visibility). Every on-behalf order logs
  `ORDER_PLACED_ON_BEHALF` (rep + buyer ids) and emails the buyer a transparency
  notice.
- **Merchant admin** at `/app/reps`: invite reps (magic link), assign companies,
  and a **rep leaderboard** (quotes / orders / win rate) derived from attributed
  quotes.
- **Plan gating.** Growth-only (`repPortalAllowed`, `PLAN_LIMITS.repSeatCap` = 0
  Starter / 3 Growth). Starter sees "Add your sales team — upgrade to Growth."
  Events `REP_INVITED`, `ORDER_PLACED_ON_BEHALF`. New editable templates
  `rep_invite`, `rep_order_placed`. Dark-launched behind `MANNON_FF_REP_PORTAL`.
  Migration `f12_sales_rep_portal`. Optional first-run nudge in Settings. See
  `docs/sales-rep-portal.md` for the isolation + impersonation-audit guarantees.

### Added — Feature 11: Custom Catalogs & Per-Customer Product Visibility

- **See only your products.** A `Catalog` (visibility `ASSIGNED` = deny-by-default
  / `ALL` = everything-but-hidden) is resolved for each buyer by precedence:
  **member > company > group (customer tag) > store default**. Assigned via
  `CatalogAssignment`, built from `CatalogItem` include/exclude rows or CSV.
- **One enforcement point, no leaks.** The portal, order pad (F4), reorder, and
  quote builder all read products through `getVisibleCatalog`, so a hidden SKU is
  **removed, never greyed** — and can't leak via the list, a direct/submitted
  variant id, or the quote line-item picker. Resolution is cached per buyer.
- **Merchant builder** at `/app/catalogs`: create catalogs, check products in/out,
  assign to company/group/member, CSV import (Growth), and a **"preview as
  customer"** split view that matches exactly what the buyer sees.
- **Plan gating.** Starter = 1 custom catalog, company-level assignment;
  Growth = unlimited catalogs + group/member assignment + CSV
  (`PLAN_LIMITS.customCatalogCap`, `catalogAssignmentScopes`, `catalogCsvAllowed`).
  Event `CATALOG_ASSIGNED`. Dark-launched behind `MANNON_FF_CUSTOM_CATALOGS`.
  Migration `f11_custom_catalogs`. Optional first-run nudge in Settings. See
  `docs/custom-catalogs.md` for the visibility-leak guarantees.

### Added — Feature 10: Accounting Sync (QuickBooks Online & Xero) (Growth)

- **Books, no re-keying.** Connect QuickBooks Online or Xero via OAuth (standard
  redirect — no pasted secrets) and every Mannon net-terms invoice, plus its
  payment when settled, syncs to the provider automatically. Tokens are
  **AES-256-GCM encrypted at rest** (`app/lib/crypto.server.ts`) and never logged.
- **Idempotent + self-healing.** Each invoice is queued once per provider (DB
  unique on shop+provider+entity+localId — a retry or double-checkout never
  double-posts), synced by `/internal/cron/accounting` (CRON_SECRET) with capped
  exponential backoff, and parked as **FAILED** with a **Retry** button after
  `SYNC_MAX_ATTEMPTS`. A failed sync never blocks the Shopify order.
- **Field mapping.** Map Mannon tax classes → provider tax codes and a default
  income account, choose customer match strategy (email / name), and a sandbox
  test-mode toggle — at `/app/accounting`.
- **Failure digest.** One merchant email (not per-event spam) summarizes
  undigested failures; new editable template `accounting_sync_failure`.
- **Plan gating.** Growth-only (`accountingSyncAllowed`); Starter sees "Connect
  your accounting — upgrade to Growth." Optional first-run nudge in Settings.
  Events `ACCOUNTING_CONNECTED`, `INVOICE_SYNCED`. Dark-launched behind
  `MANNON_FF_ACCOUNTING_SYNC`. Migration `f10_accounting_sync`. No new Shopify
  OAuth scope (QBO/Xero are external OAuth). See `docs/accounting-sync.md`.

### Added — Feature 9: MOQ, Order Minimums & Pack/Case-Size Rules

- **Wholesale order controls.** Minimum order quantity (MOQ), order-value
  minimums, and pack/case-size multiples via `OrderRule`, resolved by specificity
  (product > customer-group > collection > store; most-specific wins).
- **One resolver, three surfaces.** The pure `app/lib/order-rules.ts` enforces
  identically in the **portal cart / order pad**, the **F4 order pad** display
  (live rounding hints + minimum-order progress bar), and **quote → order
  conversion**. Quantities round **up** and are never silently dropped — every
  change is explained ("sold in cases of 12 — rounded to 24"). A cart under the
  store minimum is blocked with an "add $X more" shortfall.
- **Merchant editor** at `/app/order-rules`: rule table, a live **"test this
  cart"** preview, and CSV bulk import (Growth).
- **Plan gating.** Both plans; Starter = store + product scope; Growth adds
  collection + customer-group scopes, pack multiples, and CSV
  (`allowedRuleScopes` / `packRulesAllowed`). Event `ORDER_RULE_APPLIED`. Dark-
  launched behind `MANNON_FF_MOQ`. Migration `f9_moq_rules`.

### Added — Feature 8: Automated Quote Follow-ups, Expiry & Reminders

- **Stop quotes going cold.** A store follow-up policy (expiry days + nudge
  cadence + max nudges) schedules per-quote reminders, an expiry warning, and the
  expiry itself. Each buyer email carries accept/counter deep-links.
- **Self-healing scheduler.** `/internal/cron/followups` (CRON_SECRET) reconciles
  schedules (schedule active quotes, cancel terminal ones) then dispatches due
  nudges and runs expiries via the existing status machine (`expireQuote`).
- **Guardrails.** Never exceeds `maxNudges`; respects buyer **unsubscribe** (signed
  email link → `/portal/unsubscribe/:id`); **quiet-hours-safe** (Mon–Fri 9–18 in
  `Shop.timezone`). Accepting a quote cancels the remaining nudges.
- **Merchant control.** A "needs a nudge" list with **Send now**, and the policy
  editor at `/app/followups`.
- **Plan gating.** Starter = expiry + a single reminder; Growth = full auto-cadence
  + multi-nudge (`PLAN_LIMITS.followupCadenceMax`). Emails (reminder /
  expiry-warning / expired) are editable in Settings. Events `FOLLOWUP_SENT`,
  `QUOTE_EXPIRED`. Dark-launched behind `MANNON_FF_FOLLOWUPS`. Migration
  `f8_quote_followups`.

### Added — Feature 7: Quote Analytics & Sales Dashboard (Growth)

- **Negotiation analytics** at `/app/analytics`: win rate, average discount,
  time-to-close, and open pipeline as KPI cards with trend sparklines and a 30/90-
  day switcher — plus top accounts, a most-discounted-SKU leaderboard, and stale
  quotes needing action. All money is in one store currency (never mixed).
- **Derived, not duplicated.** Metrics come from existing `Quote` data; discount
  is measured against the customer's F3 price list. A `QuoteMetricDaily` rollup +
  `/internal/cron/analytics` (CRON_SECRET) build daily rows and, on Mondays, send
  the opt-in **weekly digest** (`Shop.weeklyDigest`, `weekly_digest` template).
- **CSV export** of the underlying quotes; empty state before {MIN} quotes.
- **Plan gating.** Growth-only — Starter sees a locked, blurred preview with an
  upgrade CTA. Event `ANALYTICS_VIEWED`. Dark-launched behind
  `MANNON_FF_QUOTE_ANALYTICS`. Migration `f7_quote_analytics`.

### Added — Feature 6: Wholesale Registration + Gated Approval

- **Branded application funnel.** A merchant builds a wholesale form in admin
  (custom fields, types, required flags); a public URL `/apply/:shop` renders it
  with no login — a honeypot, per-key rate limit, and email dedupe guard it.
- **Approval queue.** Approve / reject / request-more-info from the admin queue.
  On approve, Mannon provisions an F5 **Company** + admin member with a
  passwordless magic link, assigns the F3 **default price list**, tags the
  application `b2b-approved`, and best-effort tags the Shopify customer (new
  `write_customers` scope). Trade pricing stays gated until approval.
- **Auto-approval (Growth).** Applications from allowlisted email domains approve
  automatically.
- **Plan gating.** Both plans; `PLAN_LIMITS.wholesaleFormCap` = 1 (Starter) /
  unlimited (Growth). Multiple forms, file-upload fields, and auto-approval rules
  are Growth-only. The 2nd form on Starter is blocked with an upgrade CTA.
- **Emails.** New editable templates: application received, decision, internal
  notify. Event `WHOLESALE_APPLICATION_DECIDED`. Dark-launched behind
  `MANNON_FF_WHOLESALE_REG`. Migration `f6_wholesale_registration`.

### Added — Feature 5: Company Accounts & Multi-Buyer Sub-Accounts

- **Members with roles.** A buyer is now a company member with a role (admin /
  buyer / approver) and status (invited / active). Admins invite teammates from a
  new portal **Team** tab using the existing passwordless magic-link — no new
  passwords. Extends `Buyer` rather than forking a parallel identity table.
- **Seat cap.** `PLAN_LIMITS.memberCap` = 1 (Starter) / 5 (Growth). The 2nd invite
  and the approver/admin roles are blocked on Starter with an upgrade CTA.
- **Spending approvals (Growth).** Set `Company.approvalThreshold`; a quote whose
  estimated total reaches it can't be placed until an approver approves. The accept
  action creates a pending `OrderApproval`, emails approvers (approve/reject
  deep-link), and blocks the order; approve unblocks it, reject stops it.
- **Emails.** New editable templates: member invite, approval request, approval
  decision.
- **Events.** `MEMBER_INVITED`, `ORDER_APPROVED` (append-only). Dark-launched
  behind `MANNON_FF_COMPANY_ACCOUNTS`. Migration `f5_company_accounts` (backfills
  the earliest buyer per company to ADMIN).

### Added — Feature 4: Enhanced Quick Order / Bulk Order Pad

- **Keyboard-first order pad** in the buyer portal: type-ahead SKU/product search
  (Enter adds the row and refocuses), paste `SKU,QTY` lines with per-line error
  flags, and a **live subtotal** priced with the Feature 3 resolver (volume break
  > list entry > default).
- **Saved lists.** "Save as list" and one-tap **Reorder** (deep-linkable via
  `?list=<id>`, e.g. from a reorder email). Capped per plan
  (`PLAN_LIMITS.savedListCap` = 3 Starter / ∞ Growth).
- **CSV upload (Growth).** Paste a `sku,qty` CSV with a per-line validation summary;
  gated with the Growth plan check. Starter keeps search + paste + 3 saved lists.
- The order pad is now the buyer portal's primary CTA, with first-order coaching.
- Pure parser + resolver relocated to `app/lib/quick-order.ts` (client-safe) so the
  pad parses + prices without a round-trip. Event `ORDERPAD_USED`. Dark-launched
  behind `MANNON_FF_ORDERPAD`. Migration: `f4_quick_order_pad`.

### Added — Feature 3: Customer-Specific Price Lists & Volume Pricing

- **Price lists.** Named per-variant price lists assigned to a company directly or
  by Shopify customer tag (auto-apply on signup). Buyers see their price with no
  discount codes, plus a **"you save X%"** badge in the portal quote builder.
- **Volume breaks (Growth).** Quantity-break pricing per variant.
- **Price resolver.** Pure, hard-tested precedence: **volume break > list entry >
  default** (`app/lib/price-resolver.ts`), used identically server-side and in the
  portal.
- **Bulk editor + CSV.** Polaris `IndexTable` editor; CSV export + blank template
  on any plan; **CSV import is Growth-only**, with a per-line validation summary.
- **Plan gating.** Starter = up to **3** price lists, no volume breaks, no CSV
  import. Growth = unlimited lists + volume breaks + CSV. The 4th list on Starter
  is blocked with an upgrade CTA (`PLAN_LIMITS.priceListCap`). Dark-launched behind
  `MANNON_FF_PRICELISTS`.
- Event: `PRICELIST_ASSIGNED` (append-only). Migration: `f3_price_lists`.

### Added — Feature 2: Net Terms + Credit Management

- **Invoices on net-terms checkout.** When an accepted quote becomes a draft
  order, Mannon raises an `Invoice` with `dueDate = issuedAt + termsDays` (from
  the company's credit profile, else the shop default). Idempotent by order id.
- **Credit profiles + credit check (Growth).** Per-company credit limit, terms
  (7/15/30/45/60/90), and active/hold status. A net-terms order that would push
  a company over its limit — or a company on hold — is **blocked before the draft
  order is created**; the merchant lifts it by raising the limit or clearing the
  hold (logged as `CREDIT_OVERRIDE`).
- **Aging dashboard (Growth).** Current / 1–30 / 31–60 / 60+ buckets with
  per-company outstanding balances, on the new **Credit** page.
- **Automatic reminders (Growth).** A secret-protected cron route
  (`/internal/cron/reminders`) sends T-3 / due / +7-overdue reminders, idempotent
  per invoice+stage. Templates are editable in Settings.
- **Buyer invoices.** The portal lists open invoices with due dates and a
  printable invoice page ("Download PDF" via the browser).
- **Plan gating.** Starter = net terms + due dates. Growth = credit limits, aging,
  reminders, and PDFs. Dark-launched behind `MANNON_FF_CREDIT`.
- Events: `INVOICE_CREATED`, `REMINDER_SENT`, `CREDIT_OVERRIDE` (append-only).
- Migration: `f2_net_terms_credit`.

### Added — Feature 1: AI Quote Assistant (Growth)

- **AI counter-offers inside a quote.** On an open (SUBMITTED) quote, merchants
  can click **AI suggest** on a line — or **Suggest counter-offer for all lines** —
  to get a suggested unit price, a margin/risk read, and a ready-to-send buyer
  message. Accept prefills the counter field; Edit and Dismiss are one click away.
- **Floor-margin guardrail.** A new per-shop setting, **AI floor margin**
  (default 15%), sets the lowest margin the assistant will knowingly propose. Any
  suggestion that breaches it is flagged in red and can't be accepted in one
  click. The floor is enforced in pure, unit-tested code — never trusted to the
  model.
- **Real margins.** Wholesale cost is read from Shopify
  (`ProductVariant.inventoryItem.unitCost`, new `read_inventory` scope) and cached
  per variant (`VariantCost`).
- **Plan gating.** The assistant is **Growth-only**
  (`requirePlan(billing, GROWTH_PLAN)` on the action, `featureAccess` in the UI).
  Starter merchants see a locked upsell. The public `/pricing` page and in-app
  Plans matrix show the Growth badge.
- **Guardrails.** Temperature 0, forced tool call, no autonomous action — AI
  drafts, a human confirms (guardrail #4). Every suggestion appends an
  append-only `AI_SUGGESTION_USED` event (ids + numbers only, no PII).
- **Dark launch.** Gated behind the `MANNON_FF_AI_QUOTE` feature flag.

### Notes

- Migration: `f1_ai_quote_assistant` (adds `Shop.minMarginPct`, `VariantCost`,
  `QuoteAiSuggestion`, and the `AI_SUGGESTION_USED` event type).
