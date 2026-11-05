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

## Screenshots  (6 × 1600×900, 16:9 · capture at 2× and export 1600×900)

Rules this list follows (fetched from shopify.dev on 2026-11-05: App Store
requirements 4.3.4, 4.4.3–4.4.5 and the listing best practices):

- **Only Mannon's own UI.** No browser window, no desktop, no Shopify admin chrome
  (its top bar and sidebar carry Shopify's trademarks): crop to the app's frame.
  Shopify's own pages (Orders → Drafts, the plan page) and Mannon's marketing site
  are left out.
- **3–6 desktop screenshots, each a different feature or state**, plus one of the
  mobile buyer portal (Mannon's portal is mobile-friendly).
- **No pricing, no stats, no outcome or speed claims, no reviews**, in the image or
  its headline. The words "Shopify" and "B2B" only describe compatibility.
- **No real personal data.** Use the dev store's sample company and contact
  (Snowdevil, `karine.ruby@example.com`) or the public demo buyer; never a real
  inbox, phone or address.
- **Alt text on every image**, paste-ready below.

Capture: Chrome at 1600×900 with device scale 2 (3200×1800), crop to the app frame,
place it on a solid `#F6F5FF` background with the headline above in Inter Semibold,
`#1C1D2B`. Export 1600×900 PNG. The headline is the only text added.

| # | Screen and state | How to get it | Headline (in the image) | Alt text |
|---|---|---|---|---|
| 1 | **Quote page** (`/app/quotes/:id`) with editable line prices and the **Totals from Shopify** card (subtotal, tax, total, "Calculated by Shopify") after **Recalculate with these prices** | Dev store: storefront request as `karine.ruby@example.com` → Requests → Convert to quote → lower one unit price → Recalculate | Counter each line. Shopify prices the quote. | Mannon quote page with editable unit prices and a Totals from Shopify card showing subtotal, tax and total. |
| 2 | **✦ Draft with Claude** on the same quote: the suggested price, the reason and the message, with **Use this price** and **Send counter** visible | Same quote → ✦ Draft all lines with Claude (Growth) | Claude suggests a counter. You decide what to send. | A quote line with a Claude-drafted price, reason and buyer message, and Use this price and Send counter buttons. |
| 3 | **Buyer portal accept**: Countered quote, Payment terms **Net 30**, and the "Accept this quote?" confirm panel with **Confirm & create order** | Buyers → Generate link → open in a private window → open the quote → Net 30 → Accept & create order | Buyers accept with a secure link. No password. | Buyer portal showing a countered quote, Net 30 payment terms and a confirm panel before the order is created. |
| 4 | **Storefront product page** with the Mannon blocks: Request a Quote, Add to Quote and Make an Offer, with the Request a Quote form open | Dev store product **Harbor Blend Espresso, 1 kg** (`/products/harbor-blend-espresso-1-kg`, our own photo). Not Shopify's sample snowboards: their artwork carries Shopify and Hydrogen marks (4.4.3). `npm run listing:shots -- --only=4` | Quotes and offers from your product pages. | A product page with Request a Quote, Add to Quote and Make an Offer buttons and an open quote request form. |
| 5 | **Order pad**: a pasted PO under "Paste a PO or email", **Read my order** results with matched lines, and **Request quote for these items** | Buyer portal → Open the order pad → paste e.g. "Please send 20x [SKU], 5x [SKU]" → Read my order | Paste a PO. Claude matches it to your catalog. | Buyer order pad with a pasted purchase order and the lines Claude matched, ready for the buyer to confirm. |
| 6 | **Mobile buyer portal** (390 px wide): Your quotes and the **Reorder a past order** card, shown on the solid background with no device frame | Public demo: `https://manosh.fly.dev/demo` → Open the buyer demo, at phone width | Reorder a past order in one tap. | Buyer portal on a phone showing a countered quote and a card to reorder a past order. |

**Upload order:** 1, 2, 3, 4, 5, 6. The core loop comes first (merchant counters,
buyer accepts), then where requests come from (4), then the buyer-side tools (5, 6).

**Left out on purpose** (from the earlier 9-shot plan): the marketing hero and
"Try the demo" strip (not app UI), Shopify's Orders → Drafts page (Shopify admin
chrome and trademarks), the separate quote inbox and branded-quote frames (too close
to shot 1), and anything showing plan prices.

**Feature media:** use the screencast below. If a still image is used instead, make
it 1600×900 on a solid background with one focal point (the quote page from shot 1),
alt text, no Shopify logo, and not repeating the app card subtitle.

**App icon:** the Mannon logomark (indigo "M" with the lime dot) on `#4F46E5`, square
with padding, 1200×1200 PNG. No words, no screenshot, no Shopify trademark. Shopify
asks icons to avoid text; the single-letter mark is the logo, not a word, but if a
reviewer flags it, use the mark without the letter's counter detail.

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

## Testing instructions for the reviewer  (≤ 2800 characters · 2641/2800)

Matches the flow verified live on 2026-11-05 by `npm run qa:all` (cases M2–M7,
B1–B4, D1–D5, M10). Nothing is seeded on install, so step 0 asks the reviewer to
create one B2B company contact; the public demo needs no setup.

```
Quick look with no setup: open https://manosh.fly.dev/demo and click "Open the buyer demo" (steps 9-10). The full flow on your test store takes about 10 minutes.

BEFORE YOU START (test store)
Customers > Companies: add a company with one location and one contact, using an email you can read. Mannon reads companies, locations and contacts from Shopify; it never asks for a store domain.

STEPS
1. Install from the App Store and open Mannon. Every left-nav page loads.
2. Quotes > Requests: under "Add quote requests to your storefront", click "Add to theme" for Request a Quote. The theme editor opens with the block placed; click Save.
3. On the storefront, open a product, click "Request a Quote" and send it with the contact's email. It appears under Quotes > Requests.
4. Click "Convert to quote". The quote shows "Totals from Shopify" (subtotal, tax and total priced by Shopify). Change a unit price and click "Recalculate with these prices".
5. Optional: "✦ Draft all lines with Claude" shows a suggestion; "Use this price" only pre-fills. Click "Send counter".
6. Buyers: click "Generate link" for that buyer. Open the link in a private window and click Continue. There is no password.
7. Open the Countered quote, choose Payment terms "Net 30", click "Accept & create order", then "Confirm & create order". Nothing is written before the confirm. Orders > Drafts shows the draft for the company, with Net 30 and Shopify's totals.
8. In the portal, open the order pad, paste a PO under "Paste a PO or email" and click "Read my order". Claude's matches appear; nothing is ordered until you click "Request quote for these items".
9. Public demo: https://manosh.fly.dev/demo > "Open the buyer demo". You are a sample buyer with a Countered quote; accept it as in step 7.
10. On the demo portal home, click Reorder, then "Send reorder". It becomes a draft order, or waits for the merchant when it's over the auto-approve tolerance.
11. Pricing plans: "Choose Growth" opens Shopify's plan page. Approve or decline; you return to the app.

NOTES
- ✦ Claude features are on Growth and Scale (and a one-time trial). If the ✦ buttons are missing, choose Growth (step 11) first.
- Claude never acts on its own: every output lands on a confirm screen, and every product id it returns is checked against the live catalog.
- Pricing: Shopify App Pricing. Free $0, Starter $9, Growth $29, Scale $69 per month; 14-day trial on paid plans; no per-order fees.
- GDPR and app/uninstalled webhooks are HMAC-verified; bad signatures get 401.
- The public demo allows 5 starts per hour per network.
- Privacy policy: https://manosh.fly.dev/privacy
```

---

## Reviewer resubmission note  (reply to the 5.1.2 + 1.2.2 suspension, ref 126730)

> **5.1.2 (theme app extension didn't show on the online store):** Fixed. Every
> Mannon app block (Request a Quote, Add to Quote, Convert Cart to Quote, Make an
> Offer, Price / ATC gate) now renders the moment it is added, in the theme editor
> and on the live store, on every plan. Previously the buttons started hidden and
> waited for a config call that was gated by plan and by a default-off toggle, so a
> fresh install showed nothing. The toggle now defaults to on, plan never hides a
> storefront block, and the editor shows a note explaining each block.
> Test: Online Store → Customize → product page → Add block → "Add to Quote" (or any
> Mannon block) → Save. The button is visible in the editor and on the product page;
> submitting creates an entry under Quotes > Requests (or Quotes > Offers).
> **1.2.2 (plan selection opened "There's no page at this address"):** Fixed. The
> link to Shopify's plan page used a guessed app handle; the app now reads its own
> handle from the Admin API (`currentAppInstallation.app.handle`) and builds the
> managed-pricing URL from it. Test: Pricing plans → Choose Growth opens Shopify's
> plan page for this app; approve or decline, and you return to the app with the
> plan reflected. Uninstall and reinstall: the plan page is offered again.
> Test store: [dev store]. Every step in the testing instructions was re-verified live
> on the deployed build on 2026-11-02 (admin, storefront, buyer portal and the public
> demo), with screenshots in docs/qa, alongside the end-to-end suite (tests/*.e2e.ts)
> against the served app.

---

## Network access request  (customer account UI extension `customer-account-quotes`)

Paste as the reason when requesting network access for checkout and customer
account UI extensions. Accurate to `extensions/customer-account-quotes/src/QuotesBlock.tsx`
and `app/routes/api.account.quotes.tsx`; update it if either changes.

```
Mannon's customer account block ("Your quotes", target customer-account.order-index.block.render) shows a signed-in B2B buyer the wholesale quotes they have with the merchant: status, item count, estimated total and date, with a link to accept or reorder in Mannon's buyer portal. Quotes live in Mannon's database, not in Shopify, so the block must fetch them from Mannon's server.

The block makes one read-only GET request to https://manosh.fly.dev/api/account/quotes. It sends nothing but Shopify's customer account session token in the Authorization header. The server verifies the token and takes the customer's identity only from its subject, so no email or id from the browser is trusted and a buyer can only see their own quotes. The response contains no payment data and nothing is written; any action happens on Mannon's portal after the buyer clicks through. No third-party services are called from the extension.
```

Short version, if the form asks for one:

```
Shows a signed-in B2B buyer their wholesale quotes, which are stored on Mannon's server, by making one read-only request to https://manosh.fly.dev/api/account/quotes authenticated with Shopify's customer account session token. The server identifies the buyer only from the verified token; nothing is written and no third parties are called.
```

---

## Pre-submission checklist (dashboard side)

- [ ] Protected customer data access: Level 1 + **Email** only (deselect Name; no
      query reads names, phone or address — see docs/compliance.md). Was saved
      2026-11-01 with email + name;
      Data protection details answered (see docs/data-protection.md) —
      required before resubmitting. Until Shopify records it, every draft order
      (buyer accept, reorder, merchant convert, offer convert) fails with
      `ACCESS_DENIED … CalculatedDraftOrder`, and the orders list reads as empty, so
      the demo shows no reorder card. Partner Dashboard → Apps → Mannon → API access →
      Protected customer data access:
      1. Select **Protected customer data** itself (the Level 1 box), with a reason
         such as "Creating B2B draft orders and reading past orders for reorder".
      2. Then select **Email** (Level 2) with a reason. Leave Name, Phone and Address unselected.
      3. Complete **Data protection details** (the questionnaire) and save — a
         dev-store app gets access only after this step, and only once a
         distribution method is chosen for the app.
      4. Re-open the app in the dev store admin once, then run demo steps 12–14
         again. The accept should reach Ordered and the reorder card should appear.
- [x] App Pricing plans created in the Partner Dashboard with handles `free` /
      `starter` / `growth` / `scale` and the prices above, and **Shopify App Pricing
      enabled** (2026-11-02). Shopify's plan page on the dev store lists the four
      plans at $0 / $9 / $29 / $69; the app reads the active plan as Growth. The app now reads its own handle from the Admin API,
      so `SHOPIFY_APP_HANDLE` is only a fallback; still, open
      `https://admin.shopify.com/store/<dev-store>/charges/<app handle>/pricing_plans`
      once by hand and confirm the four plans render (review 1.2.2).
- [x] Scope change released: `write_payment_terms` replaced `read_payment_terms`
      (needed to attach Net terms to a draft order). Released as app version
      mannon-12, approved on the dev store, and reviewer steps 5–6 re-verified with
      Net 30 on 2026-11-02 (draft #D21 carries the terms).
- [ ] Theme app extension re-verified after `npm run deploy`: in the theme editor add
      each Mannon block to a product page and the cart page, save, then open the live
      store — every button is visible before touching any Mannon setting (review 5.1.2).
- [x] Release the extension update: `npm run deploy` released the app version carrying
      the customer-account extension on API 2026-07 (Preact + Polaris web components)
      and the theme extension on 2026-07. Verified 2026-09-19: the "Your quotes" block
      renders on the dev store's new customer account.
- [ ] Network access approved for the `customer-account-quotes` extension (works on
      the dev store without it; production stores need the approval). Request it
      under Partner Dashboard → Mannon → API access, with the reason in
      "Network access request" below.
- [ ] Support email filled in and monitored; privacy URL returns a page after deploy.
- [ ] Cross-store discovery directory off for the review: `MANNON_FF_DISCOVERY` unset
      on Fly, `/discover` returns 404 (QA case C16; requirement 1.1.6).
- [ ] Six screenshots captured per the shot list above (1600×900, app UI only, alt
      text pasted, no pricing or PII); icon uploaded at 1200×1200.
- [ ] Languages = admin UI languages only; "Merchant must have online store" selected.
- [ ] Dev-store click-through of steps 1–14 on the deployed build.
