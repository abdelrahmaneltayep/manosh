# App Store listing — Mannon (S18)

Copy + asset plan for the Shopify App Store listing, mapped to the Partner
Dashboard fields. Written to Shopify's content guidelines (plain language,
benefit-first, honest about scope). Paste each block into the matching field.

> **Status:** copy is final; screenshots are a shot-list (below) to capture on a
> dev store before submission (S20). Placeholder URLs use `https://mannon.app`.

---

## App name

**Mannon — B2B Quotes & Reorders**

(App name field is short; "Mannon" is the brand, the suffix aids search.)

## Tagline / subtitle (≤ 62 characters)

**Quote, counter, accept — B2B wholesale without the email**

## App card subtitle (listing grid, ~62 chars)

**Turn quote-by-email into a clean inbox. Price on draft orders.**

---

## Short description (~120 characters)

A quote negotiation loop — request, counter, accept — plus a passwordless buyer
portal and one-tap reorder, priced on real Shopify draft orders.

## Detailed description

**Stop running wholesale out of your inbox.**

Wholesale still runs on email: a buyer asks for a price, you build a spreadsheet,
they reply with changes, you re-quote, and days later maybe an order lands.
Mannon turns that whole loop into a single link.

Buyers get a passwordless portal to request a quote, counter, or reorder a past
order in one tap. You get a Polaris inbox to counter back and accept. The moment
a quote is accepted, Mannon creates a real Shopify **draft order** — with
Shopify's own totals, tax, payment terms, and PO number. Mannon never invents
pricing or tax; it orchestrates what Shopify already owns.

**What you can do**

- **Quote loop.** Buyers build a basket and submit; you counter line-by-line
  from your inbox; they accept. Every quote has a clear status and a merchant-set
  expiry.
- **One-tap reorder.** Buyers reprice and resend a past order in a tap. Small
  price moves auto-convert within a tolerance you set; larger ones wait for your
  approval.
- **Quick-order & Magic Order Pad.** Buyers paste a SKU list — or a whole PO or
  email — and Mannon matches it to your catalog. AI never acts on its own: every
  match is shown for confirmation, and every product id is checked against your
  live catalog before anything is created.
- **Net terms & PO.** Attach your existing Shopify payment terms and a PO
  reference to the draft order. Display and attach only — Shopify enforces terms.
- **ROI dashboard.** See the revenue Mannon made you, quotes sent and accepted,
  reorders, and how fast you're quoting — all from your own activity.

**Built the right way**

- Prices on real Shopify draft orders — Shopify is the single source of truth for
  money; Mannon never recomputes tax or totals.
- Minimum permissions, every webhook signature-verified, buyer links passwordless
  and single-use.
- Works on any Shopify plan.

Start with a 14-day free trial. No pricing engine to configure, no data to
migrate — install, invite a buyer, and send your first quote.

---

## Key benefits (Shopify format: 3 × title + one sentence)

1. **Quote without the email grind**
   A real quote inbox and buyer portal replace the back-and-forth — counter,
   accept, and turn it into a draft order in a few clicks.

2. **Reorders in one tap**
   Your best buyers reorder past purchases instantly, repriced to today's
   catalog, with auto-approval inside a tolerance you control.

3. **Real orders, honest about money**
   Every accepted quote becomes a real Shopify draft order. Mannon never computes
   tax or totals — Shopify does — so your books stay clean.

---

## Feature list (bullets for the features field)

- Buyer quote builder + passwordless portal (magic-link sign-in)
- Merchant quote inbox with line-by-line counter and accept → draft order
- One-tap reorder with merchant-set auto-approval tolerance
- Quick-order pad (paste SKUs) + AI Magic Order Pad (paste a PO or email)
- Shopify payment terms + PO reference on every order
- ROI dashboard built entirely from your activity
- Minimum OAuth scopes, HMAC-verified webhooks, GDPR webhooks handled

---

## Pricing (from billing config)

**Every feature is included on both plans** — quote builder, buyer portal, net
terms/PO, AI Magic Order Pad, reorder, and the ROI dashboard. Plans differ only
by enforceable **limits**, so merchants upgrade when their wholesale desk grows,
not to unlock features.

| Plan | Price | Active-quote cap | Seats |
|---|---|---|---|
| **Starter** | **$29 / month** | Up to 50 active quotes / mo (rolling 30-day) | 1 |
| **Growth** | **$79 / month** | Unlimited | Up to 5 |

- **14-day free trial** on either plan.
- Billed through Shopify's Billing API; upgrade, downgrade, or cancel anytime
  from the app's Settings.
- Gate mechanics live in `app/lib/billing.ts` (`PLAN_LIMITS`) and are enforced by
  `canCreateQuote` (quote volume) and `canAddSeat` (seats). Feature access is
  identical across tiers.

---

## Categories & search terms

- **Primary category:** Wholesale / B2B
- **Secondary:** Orders & shipping → Order management
- **Search terms:** b2b, wholesale, quotes, request a quote, reorder, draft
  order, net terms, purchase order, quote management, wholesale portal

---

## Requirements / install notes

- Works on any Shopify plan. No theme changes required — the merchant app is
  embedded in Admin; the buyer portal is a standalone passwordless page.
- Mannon runs on Shopify draft orders and its own buyer portal, so it doesn't
  depend on Shopify's company-accounts feature being set up first.

## First-use / onboarding

1. Install and pick a plan (14-day trial).
2. Open **Buyers**, generate a secure sign-in link for a B2B buyer, and email it.
3. The buyer requests a quote or reorders; you counter/accept from **Quotes**.
4. Watch the **Home** dashboard fill with the revenue Mannon made you.

---

## URLs

- **App URL:** `https://mannon.app` (set to the deployed `application_url`)
- **Privacy policy:** `https://mannon.app/privacy` (served by `app/routes/privacy.tsx`)
- **Support / contact:** `support@mannon.app`

---

## Screenshot shot-list (capture on a dev store before submission)

Shopify wants 3–6 desktop screenshots (1600×900). Each below has a caption to
overlay. Order matters — lead with the core value.

1. **Quote inbox** — merchant Quotes list with a "New" quote highlighted.
   Caption: *"Every quote request in one inbox — not your email."*
2. **Counter a quote** — the quote detail with line-by-line price edits.
   Caption: *"Counter line by line. Accept turns it into a Shopify draft order."*
3. **Buyer portal** — the passwordless buyer home with reorder cards + quotes.
   Caption: *"Your buyers get a clean portal — no password, no login friction."*
4. **One-tap reorder** — the reorder screen with quantities and repriced lines.
   Caption: *"Buyers reorder a past order in one tap, repriced to today."*
5. **Magic Order Pad** — pasted email → matched catalog lines on the confirm screen.
   Caption: *"Paste a PO or email. Mannon matches your catalog — you confirm."*
6. **ROI dashboard** — the Home dashboard with the revenue headline + tiles.
   Caption: *"See the revenue Mannon made you, built from your own activity."*

**App icon:** simple wordmark/monogram "M" on Shopify green (#008060), high
contrast, legible at 48px. (To be produced as a 1200×1200 PNG before submission.)

---

## Experience-values check (Shopify's grading bar)

- **Considerate / Trustworthy** — honest that Shopify owns pricing, tax, and
  terms; minimum scopes; clear privacy policy.
- **Familiar** — Polaris throughout the admin; App Bridge embedding.
- **Efficient / Empowering** — the important task (quote → order, reorder) is the
  obvious, fast path; sensible defaults, merchant-configurable where it matters.
- **Crafted** — designed empty and error states, accessible, plain-language copy.
