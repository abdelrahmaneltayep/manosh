# Mannon — App Review Demo Video Script & Testing Instructions

**Audience: the Shopify App Review team — NOT the public listing.** This is the
screencast a reviewer watches (and the written testing instructions) to verify the
app works, including every plan- and flag-gated feature. It is deliberately
thorough and utilitarian — unlike the ≤60s public reel
(`marketing/video-script.md` / `Mannon-Demo-Video.mp4`), which stays.

- **Record on the live dev store** against `https://manosh.fly.dev`.
- **Length:** ~7–9 min is fine for a review video (reviewers want to *see* it work;
  there's no 60s cap here). 1080p screen capture; captions preferred over music.
- **Covers all 20 shipped features (F1–F20).** Supersedes the older submission
  note that listed "Quote Copilot / Reorder Radar" as the gated features — those
  were pre-build placeholders; the shipped, gated features are the ones below.

---

## 0. Reviewer test setup (read before watching / put in "Testing instructions")

**Test store:** `______.myshopify.com` (fill in) · **App URL:** `https://manosh.fly.dev`
· **Staff login / collaborator code:** `______`

**How gating works — so you can test everything:**
Mannon has two independent gates. For review, the demo store has **both fully open**:

1. **Plan gate (Shopify Billing).** Some features are Growth-only. The demo store is
   subscribed to **Growth** (dev-store charges are test/free), so every Growth
   feature is unlocked. To *see* the Starter-locked state, open **Settings → Plan**
   and note the upgrade CTAs.
2. **Feature flags (`MANNON_FF_*`).** Each feature dark-launches behind a flag. On
   the review store **all flags are set to `true`**, so every nav item and route is
   live. (Full flag list: `docs/go-live-checklist.md`.)

**Seed data:** the store is pre-seeded with a demo Company ("Cedar & Co."), an
active buyer, real SKUs, and a past order, so quotes/reorders have something to act
on. **Test buyer portal link:** use the magic link generated in step 2 (no password).

**Compliance quick-check (reviewers usually verify these):**
- 3 GDPR webhooks + `app/uninstalled` respond and reject bad HMAC with 401
  (`docs/compliance.md`).
- Minimum scopes only: `read_products, read_orders, write_draft_orders,
  read_companies, read_payment_terms, read_inventory, write_customers` — each
  justified in `docs/compliance.md`.
- Live privacy policy at `https://manosh.fly.dev/privacy`.
- Money is never computed by the app — all totals/tax come from Shopify's
  `draftOrderCalculate`.

---

## 1. Install & onboarding · 0:00–0:45
**On screen:** Install the app from the Partner dashboard → OAuth consent (show the
minimal scope list) → land on the embedded admin **Home** (ROI dashboard, empty
state) → **Settings → Plan** shows the 14-day trial started.
**Say:** "Mannon installs as an embedded Polaris admin app. Note the minimal
scopes. On install we create the shop record and start the trial — no data crosses
stores."

## 2. Core value path — quote → counter → accept → **draft order** · 0:45–2:00
This is the heart of the app; show it end to end.
1. **Admin → Buyers** → invite a buyer → copy the **magic link**.
2. Open the magic link in a second window → **buyer portal** (non-embedded,
   passwordless). Build a basket → **submit a quote request**.
3. **Admin → Quotes** → open the request → **counter a line** → send.
4. Back in the portal → buyer **accepts**.
5. Admin → the accepted quote **creates a real Shopify draft order** — open it in
   Shopify admin and show the totals match.
**Say:** "Every accepted quote becomes a native Shopify draft order. We never
compute money — the totals are Shopify's."

### F1 · AI Quote Assistant *(Growth · `MANNON_FF_AI_QUOTE`)* · within the quote
On the quote detail, open the **AI counter-offer** panel → it suggests a price with
a **margin read** → **nothing is written until you confirm**. Show the confirm step.
**Say:** "AI never acts autonomously — every suggestion lands on a confirm screen,
temperature 0, and any product id is validated against the live catalog."

## 3. Buyer-facing tools · 2:00–3:15

- **F4 · Quick Order Pad / AI Magic Order Pad** *(both plans · `MANNON_FF_ORDERPAD`)* —
  portal **Order pad**: type-ahead SKU search, paste a SKU list, and **paste a PO/email**
  → AI matches lines → confirm → quote. Show the live subtotal.
- **F18 · Installable buyer app & one-tap reorder** *(both · `MANNON_FF_BUYER_PWA`)* —
  in the portal, show the browser's **"Add to Home Screen"**, then **One-tap
  reorder** (`/portal/shortcuts`): save a bundle → reorder it in one tap. Push
  reminders (Growth) are opt-in — show the permission prompt only appears on tap.
- **F16 · Multi-currency & Arabic/RTL** *(both · `MANNON_FF_I18N`)* — switch the
  portal language to **Arabic**: the whole portal flips **RTL**, prices show in the
  buyer's currency, and a quote's **FX rate is locked** at issue.

## 4. Merchant B2B controls · 3:15–5:00

- **F3 · Price lists** *(both, 3 on Starter · `MANNON_FF_PRICELISTS`)* — assign a
  per-company price list; show the buyer's **"you save X%"** in the portal.
- **F11 · Custom catalogs** *(both, 1 on Starter · `MANNON_FF_CUSTOM_CATALOGS`)* —
  build a catalog, **"preview as customer"** split view; confirm a hidden SKU never
  appears in the portal, order pad, or a submitted variant.
- **F9 · MOQ / order rules** *(both · `MANNON_FF_MOQ`)* — set case-of-12 → in the
  order pad, qty 20 **rounds to 24** with an explanation; min-order progress bar.
- **F2 · Net terms + credit** *(terms both / credit Growth · `MANNON_FF_CREDIT`)* —
  show an invoice with a due date; **Credit** tab: aging dashboard + a credit limit.
- **F14 · Tax & VAT** *(both · `MANNON_FF_TAX_VAT`)* — set a default rate + a
  company **exemption certificate**; the quote shows the correct tax line (from
  Shopify, not us).
- **F5 · Company accounts & approvals** *(Growth · `MANNON_FF_COMPANY_ACCOUNTS`)* —
  **Buyers/Team**: add a 2nd member; an over-threshold order routes to an approver.

## 5. Growth & funnel features · 5:00–6:30

- **F6 · Wholesale registration** *(both · `MANNON_FF_WHOLESALE_REG`)* — open the
  public **`/apply/{shop}`** form → submit → **Wholesale** queue → approve →
  a Company + magic-link buyer is provisioned + default price list assigned.
- **F17 · Storefront "Request a Quote" widget** *(both · `MANNON_FF_QUOTE_WIDGET`)* —
  on the **storefront** product page, show the theme app block button → submit a
  request → it appears in **Requests** → **convert to a quote** in one click.
- **F19 · Catalog sharing & B2B discovery** *(Growth · `MANNON_FF_CATALOG_SHARE`)* —
  **Catalog sharing**: publish a catalog (prices hidden) → open the public
  **`/catalog/{shop}/{slug}`** page (no prices, no hidden SKUs) → **request access**
  → approve → prices unlock for that buyer. Show **`/discover`**.
- **F7 · Quote analytics** *(Growth · `MANNON_FF_QUOTE_ANALYTICS`)* — **Analytics**:
  win rate, avg discount, time-to-close, pipeline.
- **F8 · Follow-ups & expiry** *(both · `MANNON_FF_FOLLOWUPS`)* — a quote's expiry +
  scheduled reminder timeline.

## 6. Operations & integrations · 6:30–7:45

- **F12 · Sales-rep portal** *(Growth · `MANNON_FF_REP_PORTAL`)* — **Reps**: invite
  a rep → they order **on behalf of** an assigned account, scoped to it.
- **F13 · Flexible payments** *(Growth · `MANNON_FF_FLEX_PAY`)* — **Payments**: a
  deposit % + installments + a copy-able **pay-link**; capture runs through Shopify
  checkout — **the app never stores card data**.
- **F10 · Accounting sync** *(Growth · `MANNON_FF_ACCOUNTING_SYNC`)* — **Accounting**:
  a **"Connected to QuickBooks"** badge + a sync log (OAuth tokens encrypted at rest).
- **F15 · ERP / inventory sync** *(Growth · `MANNON_FF_ERP_SYNC`)* — **ERP sync**:
  connected state + a two-way sync log (stock in / orders out), oversell guard.

## 7. Agency / white-label · 7:45–8:30

- **F20 · White-label / agency** *(Growth · `MANNON_FF_WHITE_LABEL`)* — **Agency**:
  an org with **2 linked stores** + a combined rollup → **Open** switches into a
  store (no re-login) → apply a client's **logo/colors** to **that store's buyer
  portal only** → show the Shopify **admin stays Mannon/Polaris**, and that data
  never crosses stores. Note: **each managed store keeps its own Growth
  subscription** — the org view is management-only, never a billing bypass.

## 8. Compliance & close · 8:30–end
Show: `/privacy` loads; **Settings** demonstrates the plan gate (open on Growth,
locked CTAs on Starter); mention the 3 GDPR webhooks + `app/uninstalled` +
HMAC-401. Close on **Home** (ROI dashboard populated after the order).

---

## Feature → where to find it (reviewer cheat-sheet)

| # | Feature | Location | Plan | Flag |
|---|---------|----------|------|------|
| F1 | AI Quote Assistant | Quotes → quote detail | Growth | `MANNON_FF_AI_QUOTE` |
| F2 | Net terms + credit | Credit | terms both / credit Growth | `MANNON_FF_CREDIT` |
| F3 | Price lists | Price lists | both | `MANNON_FF_PRICELISTS` |
| F4 | Quick / AI order pad | Portal → Order pad | both | `MANNON_FF_ORDERPAD` |
| F5 | Company accounts | Buyers / Team | Growth | `MANNON_FF_COMPANY_ACCOUNTS` |
| F6 | Wholesale registration | Wholesale · `/apply/{shop}` | both | `MANNON_FF_WHOLESALE_REG` |
| F7 | Quote analytics | Analytics | Growth | `MANNON_FF_QUOTE_ANALYTICS` |
| F8 | Follow-ups & expiry | Follow-ups | both | `MANNON_FF_FOLLOWUPS` |
| F9 | MOQ / order rules | Order rules | both | `MANNON_FF_MOQ` |
| F10 | Accounting sync | Accounting | Growth | `MANNON_FF_ACCOUNTING_SYNC` |
| F11 | Custom catalogs | Catalogs | both | `MANNON_FF_CUSTOM_CATALOGS` |
| F12 | Sales-rep portal | Reps | Growth | `MANNON_FF_REP_PORTAL` |
| F13 | Flexible payments | Payments | Growth | `MANNON_FF_FLEX_PAY` |
| F14 | Tax / VAT | Tax & VAT | both | `MANNON_FF_TAX_VAT` |
| F15 | ERP / inventory sync | ERP sync | Growth | `MANNON_FF_ERP_SYNC` |
| F16 | Multi-currency & language | Languages · portal | both | `MANNON_FF_I18N` |
| F17 | Storefront quote widget | Requests · storefront block | both | `MANNON_FF_QUOTE_WIDGET` |
| F18 | Buyer PWA & one-tap reorder | Portal → One-tap reorder | both | `MANNON_FF_BUYER_PWA` |
| F19 | Catalog sharing & discovery | Catalog sharing · `/catalog/…` · `/discover` | Growth | `MANNON_FF_CATALOG_SHARE` |
| F20 | White-label / agency | Agency | Growth | `MANNON_FF_WHITE_LABEL` |

---

## Recording checklist
- [ ] Review store on **Growth** + **all `MANNON_FF_*` = true** (so nothing is hidden).
- [ ] Seed data present (Company, buyer, SKUs, a past order).
- [ ] Two windows ready: embedded **admin** + **buyer portal** (magic link).
- [ ] 1080p capture, captions on, ~7–9 min, no PII/real card data on screen.
- [ ] Fill the placeholders in §0 (store URL, staff login) before submitting.
