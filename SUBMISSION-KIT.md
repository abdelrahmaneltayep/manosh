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

## App details  (≤ 500 characters · plain text, no formatting, no links)

```
Mannon gives your B2B buyers a real buying workflow, not just a cart.

Buyers request a quote, you counter, they approve, and it becomes a native Shopify draft order. Built on Shopify's native B2B, so every price, tax and total comes from Shopify.

Claude drafts counters, replies and order carts, and flags win rates and credit risk. You review and send; it never acts on its own.

Buyers get a passwordless portal where every past order is a one-tap reorder card. Try the live demo first.
```

## Features  (5 × ≤ 80 characters)

```
Quote requests & counters — accepting turns the quote into a Shopify draft order
Draft with Claude: it drafts counters, replies & carts, you send
Passwordless buyer portal — no account, no password to accept or reorder
Every past order becomes a one-tap reorder card in the buyer's portal
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

**Meta description** (≤ 160 · 159/160)

```
The B2B workflow your store is missing: quotes, Claude-drafted counters, net terms, one-tap reorder. Accepted quotes become Shopify draft orders. Try the demo.
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
| Screencast link (listing "App demo video" field) | *(paste the unlisted YouTube URL here after uploading `mannon-walkthrough.mp4` — see "Uploading the screencast" below)* |
| Public demo | The landing page `https://manosh.fly.dev` has a **Try before you install** strip with both entries; `/demo` is the hub. Live buyer demo at `/demo/buyer` (needs `MANNON_DEMO_SHOP` set on Fly); guided merchant tour at `/demo/tour` (sample screens, always on) |

---

## Screenshots  (9 × 1600×900, upload the 2× set at 3200×1800)

Generated from `shots.html`; no pricing and no outcome claims in any frame.

| # | File | Headline | Caption pill |
|---|---|---|---|
| 1 | `01-hero.png` | Turn B2B price questions into closed deals. | Built on Shopify's native B2B — every price comes from Shopify. |
| 2 | `02-quote-inbox.png` | Counter quotes line-by-line — Shopify builds the draft. | Priced by Shopify · one source of truth |
| 3 | `03-branded-quote.png` | Send a branded quote in under a minute. | Priced by Shopify · tax handled by Shopify |
| 4 | `04-buyer-accept.png` | Buyers accept quotes with no login. | Passwordless · one tap to accept |
| 5 | `05-ai-order-pad.png` | Paste any list. Get a ready cart. | AI drafts · you confirm every time |
| 6 | `06-draft-with-claude.png` | Claude drafts the reply. You send it. | Claude drafts · you confirm every time |
| 7 | `07-reorder.png` | Reorder a past order in one tap. (the buyer portal's Reorder a past order cards — order number, date and total as Shopify reports them — plus a Countered quote) | One tap · re-priced live by Shopify |
| 8 | `08-try-the-demo.png` | See the whole workflow. No install, no sign-up. (the landing page's Try before you install strip: live buyer portal + merchant tour) | Try the demo · manosh.fly.dev |
| 9 | `09-draft-order.png` | Accept becomes a real Shopify draft order. (Shopify admin, Orders → Drafts: #D205, PO-DEMO-1042, Net 30, tax and total from Shopify) | Priced by Shopify · a real draft order |

Upload order: 1, 2, 3, 4, 9, 5, 6, 7, 8 — the draft order (#9) belongs right after the
buyer accept (#4). Shopify's guidance is 3–6 screenshots; if trimming to 6, drop #2
(its story is covered by #3), #5 (the order pad is in the screencast) and #7.

**App icon:** monogram "M" on indigo `#4F46E5`, high contrast, legible at 48px,
1200×1200 PNG.

### Uploading the screencast

Shopify's listing takes the demo video as a **YouTube or Vimeo link**, not a file. Upload
`mannon-walkthrough.mp4` at studio.youtube.com with visibility **Unlisted**, then paste the
URL into the "App demo video" field and into the Resources table above. Paste-ready:

**YouTube title**
```
Mannon for Shopify — B2B quotes, Draft with Claude, one-tap reorder (4-minute walkthrough)
```

**YouTube description**
```
Mannon is a B2B wholesale quoting and reorder app for Shopify. Buyers request a quote, you counter (with ✦ Draft with Claude — you review and send), they accept from a passwordless portal, and it becomes a real Shopify draft order. Built on Shopify's native B2B — every price comes from Shopify.

Try the demo, no install, no sign-up: https://manosh.fly.dev/demo — accept a countered quote, or reorder a real past order in one tap.

0:00 Landing
0:16 Embedded in Shopify Admin
0:30 Dashboard
0:47 Quote inbox
1:00 New quote, priced by Shopify
1:19 ✦ Draft with Claude
1:40 Send with net terms
1:50 Buyer portal and accept
2:09 A real Shopify draft order
2:24 One-tap reorder
2:39 AI Order Pad
2:56 Claude insights
3:13 Beyond the core loop
3:31 Try the demo
3:44 A real draft order from the demo
3:52 Close
```

Settings: Unlisted · not made for kids · comments off · no end-screen promos. Keep the
video in the same Google account you use for the Partner Dashboard so the link stays yours.

**Screencast:** `mannon-walkthrough.mp4` (1920×1080, 4:00, cut to the script's timing
table; ends on the demo hub, the live buyer demo with its Countered quote and a reorder card
from a real order, and the resulting Shopify draft order). Same wording as the
screenshots: no pricing, reorder cards read "order number · date · total" exactly as the
portal renders them and reorder is "re-priced live by Shopify", and the feature tour
closes on the native-B2B line, the demo, and the resulting draft order. Script in
`mannon-screencast-script.md` (16 scenes, 4:00).

---

## Testing instructions for the reviewer  (≤ 2800 characters)

```
A demo company and buyer are seeded on install, so you can create a quote immediately. Works on any plan, no Plus needed. Native B2B (companies) is on for the test store.

STEPS
1. Install the app on the test store. Open it and click each left-nav section (Home through Pricing plans) — every page loads.
2. Quotes > New quote: add 2–3 products, set quantities.
3. Click "✦ Draft with Claude". Claude drafts a counter-offer. Review it and click Apply — the AI only pre-fills; it never sends on its own.
4. Pick a payment term (e.g. Net 30) and Send. Prices, tax and totals come from a Shopify draft order — the app never recomputes them.
5. Open the buyer view via the magic link shown after sending — no login required. Click Accept; you must confirm on a dialog before anything is written.
6. On confirm, the quote becomes a real Shopify draft order (see Orders > Drafts, source "Mannon").
7. Quote forms > AI Order Pad: paste "20x <SKU>, 5x <SKU>" — Claude matches the lines; nothing is ordered until you click Confirm & build cart.
8. Analytics: view the ✦ Claude insights (win-rate, credit-risk, buyer summary) — advisory, on screen only.
9. Reorder: one-tap reorder clones a past order into a fresh draft, re-priced by Shopify.
10. Pricing plans: click Choose plan. Shopify's plan page opens (managed pricing); pick a plan and approve. You return with the plan active.
11. Storefront: open a product page with the "Request a Quote" block and submit — it confirms in place and the request appears under Quotes > Requests.
12. Public demo (no login): on https://manosh.fly.dev, under Try before you install, click Open the buyer demo. You're a sample buyer on the demo store with a Countered quote and a reorder card from a real past order.
13. Open that quote and click Accept & create order. It flips to Ordered and a draft order (PO PO-DEMO-1042, tax and total from Shopify) appears under Orders > Drafts on the demo store.
14. Click Reorder on the card. Shopify re-prices it; within tolerance it becomes a draft order, otherwise it goes to the Quote Inbox. Start the tour walks the merchant screens.

NOTES
- AI is human-in-the-loop: temperature 0, every output lands on a confirm screen, every returned product id is checked against the live catalog. Claude never writes a quote, cart or order on its own.
- ✦ Draft with Claude and Claude insights are on Growth and Scale (and a one-time trial). If you don't see the ✦ controls, select the Growth plan.
- Pricing (managed by Shopify App Pricing): Free $0, Starter $9, Growth $29, Scale $69 per month; 14-day trial on paid plans. No per-order charges.
- GDPR webhooks (customers/data_request, customers/redact, shop/redact) and app/uninstalled are HMAC-verified; bad signatures get 401.
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
- [x] Release the extension update: `npm run deploy` released the app version carrying
      the customer-account extension on API 2026-07 (Preact + Polaris web components)
      and the theme extension on 2026-07. Verified 2026-09-19: the "Your quotes" block
      renders on the dev store's new customer account.
- [ ] Network access approved for the `customer-account-quotes` extension (works on
      the dev store without it; production stores need the approval).
- [ ] Support email filled in and monitored; privacy URL returns a page after deploy.
- [ ] Screenshots replaced with the 9-slide set in the upload order above; icon
      uploaded at 1200×1200.
- [ ] Languages = admin UI languages only; "Merchant must have online store" selected.
- [ ] Dev-store click-through of steps 1–14 on the deployed build.
