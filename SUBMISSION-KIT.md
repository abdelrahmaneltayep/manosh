# Mannon — App Store submission kit

Every Partner Dashboard listing field, filled and ready to paste. Updated to the
current app: **Shopify App Pricing (managed pricing) with four plans**, the
**7-section tabbed nav**, the **dual-mode Claude suite** (draft-only), and the live URLs
on `manosh.fly.dev`.

Listing rules this copy follows (Shopify App Store requirements 4.x):

- Pricing appears **only** in the Pricing section. No prices in the introduction,
  details, features, card subtitle, web search copy, screenshots, or screencast.
- No outcome guarantees ("always correct", "higher accept rates") and no comparisons
  with other apps. Copy describes what Mannon does and who does what.
- The one recurring line, used verbatim across the listing, screenshots, and
  screencast: **Built on Shopify's native B2B — every price comes from Shopify.**

Character limits are the Partner Dashboard's; counts are given per field.

---

## App name

```
Mannon — B2B Quotes & Reorders
```

## App introduction  (≤ 100 characters · 100/100)

```
Quote, counter with Claude, and reorder in one tap. The B2B buying workflow your store is missing.
```

## App details  (≤ 500 characters · plain text, no formatting)

```
Mannon gives your wholesale and B2B buyers a real buying workflow, not just a cart.

Buyers request a quote, you counter, they approve, and it becomes a native Shopify draft order. Built on Shopify's native B2B, so every price, tax and total comes from Shopify.

Claude drafts your counters, replies and order carts, and flags win rates, credit risk and buyer summaries. You review and send; it never acts on its own.

Buyers get a passwordless portal and one-tap reorder.
```

## Features  (5 × ≤ 80 characters)

```
Quote requests & counter-offers with a clear, trackable status trail
Draft with Claude: it drafts counters, replies & carts, you send
Passwordless buyer portal — no account, no password to accept or reorder
One-tap reorder of anything a buyer has purchased before
Native Shopify draft orders — Shopify handles prices, tax, totals & terms
```

## App card subtitle  (≤ 62 characters · 57/62)

```
B2B quotes and counters with Claude, plus one-tap reorder
```

## Web search content

**Title tag** (≤ 60 · 55/60)

```
Mannon — AI B2B Quotes, Net Terms & Reorder for Shopify
```

**Meta description** (≤ 160 · 153/160)

```
Mannon adds the B2B buying workflow your store is missing: send branded quotes, counter with Claude, accept net terms, and let buyers reorder in one tap.
```

## Categories, search terms, languages

- **Primary category:** Selling products → Wholesale and B2B
- **Secondary category:** Store management → Orders
- **Search terms** (no "Shopify" in this field):
  `b2b, wholesale, quotes, request a quote, reorder, net terms, price list, draft order, customer accounts`
- **Languages:** list only the languages the **admin UI** supports (English). The
  Arabic/RTL support is on the buyer portal and is described in the details, not
  declared as an admin language.
- **Install requirements:** "Merchant must have an online store" (the app ships a
  theme app extension). Note in the listing that Shopify's native B2B (companies +
  a B2B catalog) must be enabled.

---

## Pricing details  (Shopify App Pricing — plans are configured in the Partner Dashboard)

Mannon uses **managed pricing**: the four plans below are created under App Pricing in
the Partner Dashboard with the **lowercase handles** `free`, `starter`, `growth`,
`scale`. The app never creates charges; the in-app **Pricing plans** page sends the
merchant to Shopify's hosted plan-selection page and they return to the embedded app
with the plan active. Set `SHOPIFY_APP_HANDLE` on the server if the app handle is
not `mannon`.

| Plan | Price / mo | Trial | Highlights |
|---|---|---|---|
| **Free** | **$0** | — | Up to 10 quotes/mo · 1 company account · passwordless portal · one-tap reorder · quick order pad |
| **Starter** | **$9** | 14 days | Everything in Free · unlimited quotes & requests · up to 5 company accounts · 1 custom price list · basic quote analytics |
| **Growth** | **$29** | 14 days | Everything in Starter · ✦ Draft with Claude (counters & carts) · net terms & deposits · Make an Offer · 25 company accounts · 10 price lists · full analytics + Claude insights |
| **Scale** | **$69** | 14 days | Everything in Growth · unlimited accounts & price lists · automated offers · sales-rep portal · accounting sync · white-label buyer portal · deal-level analytics |

Paste-ready plan descriptions:

**Free — $0/mo** (handle `free`)
- Up to 10 quotes per month
- Passwordless buyer portal
- One-tap reorder of past orders
- Priced on native Shopify draft orders
- Quick order pad for buyers

**Starter — $9/mo · 14-day trial** (handle `starter`)
- Everything in Free
- Unlimited quotes & requests
- Up to 5 company accounts
- 1 custom price list
- Basic quote analytics

**Growth — $29/mo · 14-day trial** (handle `growth`)
- Everything in Starter
- Draft with Claude: counters & carts
- Net terms & deposits
- Make an Offer (manual rules)
- 25 company accounts, 10 price lists
- Full analytics + Claude insights

**Scale — $69/mo · 14-day trial** (handle `scale`)
- Everything in Growth
- Unlimited accounts & price lists
- Automated offers & pay-what-you-want
- Sales-rep portal
- Accounting sync
- White-label buyer portal
- Deal-level analytics

Notes for the Pricing section only: flat monthly fee, no per-order fees. Annual
billing, if offered, is 2 months free ($90 / $290 / $690). All Claude features are
Growth and above; Free and Starter must not advertise AI.

---

## Resources / URLs

| Field | Value |
|---|---|
| App URL | `https://manosh.fly.dev` |
| Welcome / landing link | `https://manosh.fly.dev/app` |
| Privacy policy | `https://manosh.fly.dev/privacy` |
| Support / contact email | *(fill in — must be a monitored address)* |
| Demo store URL | *(fill in your dev/demo store)* |
| Public demo (landing page) | `https://manosh.fly.dev/demo` — live once `MANNON_DEMO_SHOP` is set on Fly to the demo store's myshopify domain |

---

## Screenshots  (7 × 1600×900, upload the 2× set at 3200×1800)

Generated from `shots.html`; no pricing and no outcome claims in any frame.

| # | File | Headline | Caption pill |
|---|---|---|---|
| 1 | `01-hero.png` | Turn B2B price questions into closed deals. | Built on Shopify's native B2B — every price comes from Shopify. |
| 2 | `02-quote-inbox.png` | Counter quotes line-by-line — Shopify builds the draft. | Priced by Shopify · one source of truth |
| 3 | `03-branded-quote.png` | Send a branded quote in under a minute. | Priced by Shopify · tax handled by Shopify |
| 4 | `04-buyer-accept.png` | Buyers accept quotes with no login. | Passwordless · one tap to accept |
| 5 | `05-ai-order-pad.png` | Paste any list. Get a ready cart. | AI drafts · you confirm every time |
| 6 | `06-draft-with-claude.png` | Claude drafts the reply. You send it. | Claude drafts · you confirm every time |
| 7 | `07-reorder.png` | Reorder a past order in one tap. | One tap · re-priced live by Shopify |

Shopify's guidance is 3–6 screenshots; if trimming to 6, drop #2 (its story is
covered by #3).

**App icon:** monogram "M" on indigo `#4F46E5`, high contrast, legible at 48px,
1200×1200 PNG.

**Screencast:** `mannon-walkthrough.mp4` (1920×1080, ~2:42). Same wording as the
screenshots: no pricing, reorder is "re-priced live by Shopify", and the feature tour
closes on the native-B2B line. Script in `mannon-screencast-script.md`.

---

## Testing instructions for the reviewer  (≤ 2800 characters)

```
Test store: a demo company and buyer are seeded on install, so you can create a quote immediately. Works on any plan — no Plus or extra setup needed. Shopify's native B2B (companies) is enabled on the test store.

STEPS
1. Install the app on the provided test store. Open it and click through every left-nav section (Home, Quotes, Quote forms, Pricing & catalog, Buyers, Analytics, Settings, Pricing plans) — each loads a page.
2. Quotes > New quote: add 2–3 products, set quantities.
3. Click "✦ Draft with Claude". Claude drafts a counter-offer. Review it and click Apply — the AI only pre-fills; it never sends on its own. (Manual editing works too.)
4. Pick a payment term (e.g. Net 30) and Send. Prices, tax and totals come from a Shopify draft order — the app never recomputes them.
5. Open the buyer view via the magic link shown after sending — no login required. Click Accept; you must confirm on a dialog before anything is written.
6. On confirm, the quote becomes a real Shopify draft order (see Orders > Drafts, source "Mannon").
7. Quote forms > AI Order Pad: paste "20x <SKU>, 5x <SKU>" — Claude matches the lines; nothing is ordered until you click Confirm & build cart.
8. Analytics: view the ✦ Claude insights (win-rate, credit-risk, buyer summary) — all advisory, shown on screen only.
9. Reorder: from a past order, use one-tap reorder to clone it into a fresh draft, re-priced by Shopify.
10. Pricing plans: click Choose plan. Shopify's plan-selection page opens (managed pricing); pick a plan and approve. You return to the embedded app with the plan active.
11. Storefront: on the online store, open a product page with the "Request a Quote" block and submit the form — it confirms in place and the request appears under Quotes > Requests.

NOTES
- AI is human-in-the-loop: temperature 0, every AI output lands on a confirm screen, and every AI-returned product id is validated against the live catalog before use. Claude never writes a quote, cart, or order on its own.
- ✦ Draft with Claude and Claude insights are included on Growth and Scale (and a one-time trial). If you don't see the ✦ controls, select the Growth plan to enable them.
- Pricing (managed by Shopify App Pricing): Free $0, Starter $9, Growth $29, Scale $69 per month; 14-day trial on paid plans. No per-order charges.
- GDPR webhooks (customers/data_request, customers/redact, shop/redact) and app/uninstalled are implemented and HMAC-verified; bad signatures are rejected with 401.
- Privacy policy: https://manosh.fly.dev/privacy
```

---

## Reviewer resubmission note  (reply to the 2.1.1 storefront rejection)

> **2.1.1 ("Something went wrong" on the storefront Request a Quote form):** Fixed —
> the public quote-request endpoint and every other storefront endpoint now return a
> plain-language result instead of a server error, and the form confirms in place.
> Test: open a product page with the Request a Quote block, submit, and check
> Quotes > Requests.
> **Billing:** the app now uses Shopify App Pricing. Pricing plans → Choose plan opens
> Shopify's plan page and returns to the embedded app with the plan active.
> **API version:** moved to a supported Admin API version (2026-04).
> Test store: [dev store]. All flows verified.

---

## Pre-submission checklist (dashboard side)

- [ ] Protected customer data access requested (Level 2, fields: email, name) —
      required before resubmitting.
- [ ] App Pricing plans created with handles `free` / `starter` / `growth` / `scale`
      and the prices above; `SHOPIFY_APP_HANDLE` set if the handle isn't `mannon`.
- [ ] Network access approved for the `customer-account-quotes` extension.
- [ ] Support email filled in and monitored; privacy URL returns a page after deploy.
- [ ] Screenshots replaced with the 7-slide set (or 6); icon uploaded at 1200×1200.
- [ ] Languages = admin UI languages only; "Merchant must have online store" selected.
- [ ] Dev-store click-through of steps 1–11 on the deployed build.
