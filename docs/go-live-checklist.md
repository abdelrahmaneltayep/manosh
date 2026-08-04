# Go-live checklist — Pricing v3 · BFS · F21 · F24 · F25

Per-feature deploy checklist for the merged feature wave (Pricing v3, Built-for-Shopify
hardening, F21 Make an Offer, F24 Storefront Quote Capture, F25 Quote Ops). Everything
new is **dark by default** behind a `MANNON_FF_*` flag and/or plan gating — deploying
changes nothing for live merchants until you flip a flag.

## Two things to know

- **Email transport is a no-op** (`sendEmail` TODO). The quote-PDF email, the convert
  invoice-send, and F24 acknowledgements won't deliver until a mail provider is wired.
  PDF **download** works fully.
- **All new work is flag-gated** — including F25 now (`MANNON_FF_QUOTE_OPS`), so nothing
  ships to merchants on deploy alone.

## 0. Shared prerequisites (once, all features)

- [ ] `fly deploy` — release command runs `prisma migrate deploy`, applying the **10 new
      migrations**: `pricing_v3`, `make_an_offer`, `quote_capture`,
      `quote_capture_advanced`, `price_visibility`, `quote_capture_i18n`, `quote_ops`,
      `quote_pdf`, `quote_source`, `quote_import`. Additive — existing rows default cleanly.
- [ ] `shopify app deploy` — ships the 3 extensions: `quote-widget` (F17 + F24 blocks),
      `make-an-offer` (F21), `customer-account-quotes` (F25).
- [ ] Runtime secrets set (`fly secrets list`): `SHOPIFY_API_KEY/SECRET`, `SHOPIFY_APP_URL`,
      `SESSION_SECRET`, `DATABASE_URL`.
- [ ] `/healthz` → `configOk: true`; app boots and loads in Admin.

---

## 1. Pricing v3 — 4-plan ladder + grandfathering

- **Flag:** `MANNON_FF_PLAN_V3=true` (off = legacy Starter $29 / Growth $79 unchanged)
- [ ] Confirm the v3 plan handles (free / starter $9 / growth $29 / scale $69) exist in the
      Shopify billing config.
- [ ] Flip on a **test shop** first. Verify a **grandfathered** subscriber keeps their old
      price (legacy Starter $29 → growth caps; legacy Growth $79 → scale caps) — no silent raise.
- [ ] New subscribe flow shows the 4-plan ladder; `NO_PER_ORDER_FEES_COPY` renders in
      Settings → Plan & billing.
- [ ] **Rollback:** flag `false` → back to the 2-plan behaviour.

## 2. Built-for-Shopify hardening (§3.1 / §3.2 / §3.3) — no flag, always-on

- [ ] `/app/debug/config` (owner-only) green; nav has no dead links.
- [ ] Contextual **Save Bar** on `/app/offers/widget` (once F21 is on); empty states show a
      real illustration.
- [ ] A multi-line offer triggers **one batched** variant-cost read (no N+1) in logs.
- [ ] No rollback — pure hardening.

## 3. F21 Make an Offer

- **Flag:** `MANNON_FF_MAKE_AN_OFFER=true` (off → `/app/offers` 404)
- **Gate:** teaser (free/starter) · manual + rules (growth) · automation + PWYW + convert (scale)
- **Extension:** `make-an-offer`
- [ ] Add the **Make an Offer** block to a product template.
- [ ] Submit an offer → lands in `/app/offers`; the **margin floor is never breached** on
      auto-accept/counter.
- [ ] Scale shop: auto-decline/accept/counter + PWYW; "Convert to draft order" makes a native
      draft at the agreed price.
- [ ] **Rollback:** flag `false`.

## 4. Quick wins — no flag

- [ ] PostHog receives `offer_created/countered/accepted/converted` funnel events.
- [ ] Fresh-install seed shows a demo offer in `/app/offers` (paid + flag on).

## 5. F24 Storefront Quote Capture

- **Flag:** `MANNON_FF_QUOTE_CAPTURE=true` (off → `/app/quote-forms`, `/app/price-rules`,
  capture APIs inert)
- **Gate:** basic builder = all · conditional logic / multiple forms / i18n = Growth · price
  gating: logged-out = Starter, tag/product/collection = Growth · Add-to-Quote = Starter+
- **Extension:** `quote-widget` blocks (form render, `price_gate`, `add_to_quote`, `cart_to_quote`)
- [ ] Build a form in `/app/quote-forms`; add its block on a product page → renders your fields;
      the submission carries `formId` through to the converted Quote.
- [ ] **Price gating (critical):** add a logged-out rule in `/app/price-rules`, place the
      `price_gate` block → price/ATC hidden, Request-a-Quote CTA shown. **View page source: the
      hidden price must not appear** (the decision API returns no price by design).
- [ ] Add-to-Quote drawer collects across pages → one multi-line quote; cart→quote works.
- [ ] Post-submit: message vs redirect honored; add a locale translation → form renders localized.
- [ ] **Rollback:** flag `false`.

## 6. F25 Quote Ops & Conversion

- **Flag:** `MANNON_FF_QUOTE_OPS=true` (off → convert / PDF / duplicate / import / customer-account
  routes 404 and their admin UI is hidden)
- **Gate:** convert / PDF / duplicate / customer-account = Starter+ · bulk import = Growth
- **Extension:** `customer-account-quotes`
- [ ] **Convert** (`/app/quotes/:id` → Convert to order & send invoice): draft order created at
      **exact negotiated prices**; buyer must be linked to a company location.
- [ ] **PDF:** Download works (branded; white-label footer removed on Growth). *Email button won't
      deliver until the mailer is wired.*
- [ ] **Duplicate:** creates an editable `SUBMITTED` copy with `source = DUPLICATE`.
- [ ] **Bulk import** (`/app/quotes/import`, Growth): preview shows per-row errors; a batch with any
      error commits **nothing**.
- [ ] **Customer-account extension:** set `APP_URL` in
      `extensions/customer-account-quotes/src/QuotesBlock.tsx`; enable **new customer accounts** on
      the store; verify the "Your quotes" block lists quotes. (Hardening TODO: cross-check email vs
      token identity before GA.)
- [ ] **Rollback:** flag `false`.

---

## Flag summary

| Flag | Turns on |
|---|---|
| `MANNON_FF_PLAN_V3` | 4-plan ladder + grandfathering |
| `MANNON_FF_MAKE_AN_OFFER` | F21 Make an Offer (admin + storefront) |
| `MANNON_FF_QUOTE_CAPTURE` | F24 form builder, price gating, Add-to-Quote, post-submit/i18n |
| `MANNON_FF_QUOTE_OPS` | F25 convert, PDF, duplicate, bulk import, customer-account quotes |

Recommended order to flip: Pricing v3 → F21 → F24 → F25, each verified on a test shop first.
