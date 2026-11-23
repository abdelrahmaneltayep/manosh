# Mannon promotion plan (brief for a Claude session)

Written 2026-11-23, the day after Mannon was published on the Shopify App Store.
This file is self-contained: a session that has only this file and
`docs/b2b-store-leads.md` can do the work. The owner's own summary of the strategy is
the go-to-market plan at https://claude.ai/artifact/PZn7AiKkkUPtjozRfm9tdn.

**Goal:** 10 customers by 2026-12-23. A customer is a store that installed Mannon,
chose a plan and sent at least one real quote. About 30 installs are needed.

---

## 1. How to work from this file

You are helping the founder, Abdelrahman, promote the app. He is one person, with
about one hour a day for this.

- **You draft; he approves and sends.** Never send a message, publish a post, submit a
  form, start an ad or change the App Store listing yourself unless he tells you to in
  that conversation, for that specific item.
- **Never type credentials or sign in for him.** If a site needs a login, stop and let
  him do it.
- **Say only what section 2 says about the product.** If a prospect asks something
  section 2 doesn't answer, say you'll check, and ask the founder.
- **One message and one follow-up per store, then stop.** If anyone says no or asks to
  stop, mark the lead `Do not contact` and never message them again.
- **Log every touch** in the lead sheet (section 9) the moment it happens.
- **Report in plain numbers** at the end of each session: messages drafted, sent,
  replies, installs, and anything that needs the founder's decision.

---

## 2. Facts about Mannon (the only claims you may make)

**What it is.** A Shopify app for stores that sell wholesale. Buyers request a quote
on the store, the merchant counters on one screen, and the accepted quote becomes a
Shopify draft order. Shopify calculates every price, tax and total; Mannon never
computes money itself.

**Links**

| What | URL |
|---|---|
| App Store listing | https://apps.shopify.com/mannon |
| Public demo (no install, no sign-up) | https://manosh.fly.dev/demo |
| Support | support@mannon.app |
| Privacy policy | https://manosh.fly.dev/privacy |

**What it does**

- **Request a Quote button** on product pages, plus Add to Quote and Convert Cart to
  Quote. Added from the theme editor, no code.
- **Quote inbox** for the merchant: change line prices and quantities, recalculate,
  send a counter. Totals come from Shopify.
- **Passwordless buyer portal:** the buyer opens a sign-in link, accepts the quote and
  can reorder any past order in one tap. Works in English, Arabic and French.
- **Order pad** (every plan): buyers type or pick items to order quickly. On Growth and
  Scale they can also paste a purchase order or email and Claude matches it to the
  catalog; the buyer confirms before anything is ordered.
- **Hide prices** from guests or chosen customers until they sign in or ask for a
  quote (Starter and above).
- **Draft with Claude** (Growth and Scale): suggests a counter price, the reason and a
  message. The merchant reviews and sends; nothing is sent automatically.
- **Net terms and deposits** (Growth and Scale), written onto the Shopify draft order.
- **Make an Offer** button (Growth and Scale), price lists, custom catalogs, company
  accounts, analytics.
- **Scale only:** sales-rep portal, accounting sync (QuickBooks, Xero), ERP export,
  white-label buyer portal.

**Plans** (billed by Shopify, flat monthly price, no per-order fees)

| Plan | Price | Trial | Main limits |
|---|---|---|---|
| Free | $0 | none | 10 quotes a month, 1 company account |
| Starter | $9 a month | 14 days | Unlimited quotes, 5 company accounts, 1 price list |
| Growth | $29 a month | 14 days | Adds Claude drafting, net terms, deposits, Make an Offer |
| Scale | $69 a month | 14 days | Adds rep portal, accounting and ERP sync, white-label |

**Requirements**

- A Shopify online store (the buttons are theme app blocks).
- Buyers are read from Shopify's company accounts (Customers > Companies). A store
  that doesn't use company accounts can't use the buyer portal. Always check this
  with a prospect early.
- The merchant admin is in English.

**Do not claim**

- Any number about results: time saved, revenue, win rate, speed.
- Any customer count, logo or review. There are none yet.
- "Best", "number one", "official", or any ranking.
- Features not listed above. In particular: no WhatsApp, no CRM sync, no mobile app.
- Automatic follow-up or reminder emails, until the founder confirms the scheduled
  jobs are switched on (`docs/scheduled-jobs.md`).
- That Claude acts on its own. Every AI output is a draft that a person confirms.
- AI features on Free or Starter. Claude drafting is Growth and Scale only.

---

## 3. Rules you must not break

These protect the listing. Shopify removes apps for the first three.

1. **No incentives for reviews.** Never offer a discount, credit, gift or favour for a
   review, and never ask for a positive review. A neutral ask after a good support
   exchange is fine: "If you have a minute, we'd value your honest feedback on the App
   Store."
2. **No review requests by cold email, and none during install or onboarding.**
3. **No fake or planted reviews, by anyone connected to the founder.**
4. **No bulk or automated outreach.** Every message is written for one store and names
   something true about it. Prefer the store's own contact or wholesale form, or the
   company's LinkedIn page. Email rules differ by country, so do not build or buy
   email lists.
5. **No personal data.** Record company names and public business contact routes
   only. No personal emails, phone numbers or names of individuals unless they wrote
   to us first.
6. **Community rules come first.** Before posting in any forum, subreddit or group,
   read its self-promotion rules. Where promotion isn't allowed, answer the question
   and leave Mannon out. Always disclose: "I'm the founder of Mannon."
7. **Shopify brand use:** only use Shopify's App Store badge from its brand-assets
   page, unmodified. Do not imply Shopify endorses Mannon.

---

## 4. Who to reach, and the angle for each

The pitch in one line: **Mannon turns "can you send me a price?" emails into Shopify
draft orders.**

Three proof points, in this order: Shopify calculates every total; buyers need no
password; there is a free plan and a click-through demo.

| Segment | How to spot them | Angle that fits |
|---|---|---|
| Brands with a wholesale page that says "email us" or "apply" | `/pages/wholesale`, "stockists", "become a retailer" | Replace the email back-and-forth with a quote the buyer accepts in one click |
| Trade suppliers with a quote form | "Request a quote", "bulk pricing", "volume discounts" | The quote ends as a Shopify draft order with Shopify's own tax and totals, not a PDF |
| Stores with repeat wholesale buyers | Cafes, salons, retailers reordering the same items | One-tap reorder of any past order, and a quick order pad |
| Arabic- or French-speaking buyers | Arabic or French storefront, Gulf or North African or French address | The buyer portal already works in Arabic (right-to-left) and French |
| Agencies that build B2B Shopify stores | Agency case studies mentioning wholesale or B2B | A quoting layer on Shopify's native B2B that they can set up for a client in an hour |

Poor fit, do not spend time: retail-only stores, stores not on Shopify, enterprises
with an ERP-driven buying process, and stores that already run a full self-serve
wholesale portal with live pricing.

---

## 5. Channels and what to do in each

Ranked by expected installs in the first 30 days. Outreach carries month one, because
a new listing with no reviews gets little search traffic.

### 5.1 Direct outreach (target 10 installs)

Work through `docs/b2b-store-leads.md`, ten stores a day.

For each store, before drafting:

1. Open the wholesale or quote page. Confirm it still exists and still asks buyers to
   email, apply or request a quote.
2. Confirm it is a Shopify store: view the page source and find `cdn.shopify.com`.
   If it isn't there, mark the lead `Not Shopify` and skip it.
3. Find the public business contact route: the wholesale form, a wholesale@ or
   sales@ address shown on the page, or the company's LinkedIn page.
4. Note one specific true detail to open with, for example their minimum order, the
   form they use, or what they say about pricing.

Then draft the message from section 8, show it to the founder, and log it once sent.
Send one follow-up after four working days, then stop.

### 5.2 App Store listing (target 6 installs)

Draft these for the founder to enter in the Partner Dashboard:

- **Search terms:** cut to five, one idea each: `request a quote`, `b2b quotes`,
  `wholesale quotes`, `net terms`, `reorder`.
- **Translations:** Arabic and French versions of the app introduction, details and
  feature list. Translate meaning, not word for word, and keep every claim inside
  section 2.
- **Feature video:** a 2 to 3 minute promotional video. Shopify asks that screen
  recording be at most about a quarter of it. Draft the script and shot list.
- **Customer story:** when the first customer agrees, add two sentences to the app
  details.

### 5.3 App Store search ads (target 6 installs)

Only the founder can buy ads, from the Partner Dashboard. Prepare the plan for him:

- Start with exact phrases: `request a quote`, `b2b quotes`, `wholesale quotes`,
  `net terms`, `quote request`.
- Daily cap about $10. You pay per click, at your bid.
- Stop any keyword that reaches 50 clicks with no install. Raise the bid only on
  keywords that produced a customer, not just an install.
- Review every Friday with the numbers from the dashboard.

### 5.4 Agencies (target 4 installs)

Find 20 agencies that show B2B or wholesale Shopify work in their case studies, using
the Shopify Partner Directory and agency sites. Use the agency message in section 8.
The offer is honest and specific: the founder sets Mannon up on one client store
himself, free, in exchange for feedback.

### 5.5 Content (target 2 installs this month, more later)

Each piece answers a question a wholesale merchant actually searches for, shows the
steps in Shopify, and mentions Mannon once, near the end, with the demo link.

| # | Title | What it shows |
|---|---|---|
| 1 | How to add a Request a Quote button to a Shopify B2B store | Theme editor, app blocks, where requests arrive |
| 2 | Net terms and deposits on Shopify draft orders, step by step | Payment terms on a draft order, what the buyer sees |
| 3 | Let wholesale buyers reorder without emailing you | Reorder from past orders, purchase-order pasting |
| 4 | Selling wholesale to Arabic- and French-speaking buyers on Shopify | A buyer portal in the buyer's language |

Draft as LinkedIn articles first (the founder publishes from his own profile). Each
article also becomes one short post and one 30 to 60 second screen clip.

### 5.6 Social, from the founder's own profile (target 1 install)

Three LinkedIn posts a week for four weeks. Themes, in rotation:

1. **The problem:** a real pattern from wholesale pages ("email us for pricing"), with
   no store named.
2. **A 30-second clip:** one feature, one sentence, the demo link.
3. **Building in public:** what shipped this week, what a merchant asked for.

No engagement bait, no invented statistics, no tagging people who didn't ask.

### 5.7 Communities (target 1 install)

Shopify Community forums and merchant groups where B2B questions are asked. The work
is answering questions well. Draft the answer so it is complete without Mannon; add
one disclosed line about Mannon only where the rules allow it and it truly fits.

### 5.8 Reviews

From week 3, after a customer has sent a quote and had a good support exchange, the
founder may ask neutrally for honest feedback. Draft replies to every review,
including negative ones: thank them, state the fix, never argue.

---

## 6. Thirty-day calendar

| Week | Dates | Outreach | Listing and ads | Content and social | Check on Friday |
|---|---|---|---|---|---|
| 1 | Nov 23 to 29 | Verify 50 leads; send 30 messages | Draft search terms, AR and FR listing text, video script | Article 1; 3 posts | 6 installs, 1 customer |
| 2 | Nov 30 to Dec 6 | 50 messages, follow-ups; 20 agencies | Founder starts ads; publish translations | Article 2; 3 posts; 2 clips | 14 installs, 4 customers |
| 3 | Dec 7 to 13 | 50 messages to stores like those that converted | Stop dead keywords; record the feature video | Article 3; 3 posts; first customer story | 22 installs, 7 customers |
| 4 | Dec 14 to 23 | 50 messages; personal follow-up with stalled installs | Add the customer story to the listing | Article 4; 3 posts | 30 installs, 10 customers |

If a week misses, keep the goal and change one thing. Too few messages is a time
problem. Too few replies is a message problem: rewrite the first line. Installs
without quotes is an onboarding problem: the founder offers a setup call.

---

## 7. Assets to prepare in week 1

- [ ] A one-page description of Mannon in plain words, built only from section 2.
- [ ] A 60 to 90 second demo clip: storefront request, counter, buyer accepts, draft
      order appears.
- [ ] Five 30-second clips: Request a Quote button, counter with Shopify totals, buyer
      accepts with no password, one-tap reorder, paste a purchase order.
- [ ] Arabic and French versions of the first outreach message and the listing text.
- [ ] A booking link for 20-minute setup calls (the founder creates it).
- [ ] Three saved support replies: getting started, adding the button, choosing a plan.

---

## 8. Messages

Fill every bracket by hand from what you saw on the store's own site. If you can't
name something specific and true, do not send.

**First message to a store**

```
Hi, I saw [store] asks wholesale buyers to [email for pricing / fill in the trade form].

I built Mannon, a Shopify app for exactly that step: buyers click Request a Quote on a
product, you counter on one screen, and the accepted quote becomes a Shopify draft
order with Shopify's own totals.

You can click through a 2-minute demo without installing anything:
https://manosh.fly.dev/demo

One question before you look: do you manage wholesale buyers as companies in Shopify?
Mannon reads them from there. If it looks useful, I'll set it up on your store with you
in 20 minutes. There's a free plan.

Abdelrahman, founder of Mannon
```

**Follow-up, four working days later, once**

```
One more note and then I'll leave you in peace. If wholesale pricing emails aren't a
pain for [store], ignore this. If they are, the demo shows the whole flow in 2 minutes:
https://manosh.fly.dev/demo
```

**Arabic first message**

```
مرحباً، لاحظت أن [المتجر] يطلب من عملاء الجملة [التواصل عبر البريد لمعرفة الأسعار / تعبئة نموذج].

أنا مؤسس Mannon، تطبيق على Shopify لهذه الخطوة تحديداً: يضغط العميل على «طلب عرض سعر»
في صفحة المنتج، فترد عليه بعرضك من شاشة واحدة، وعند قبوله يتحول العرض إلى طلب مسودة في
Shopify، وShopify هو من يحسب الأسعار والضريبة والإجمالي.

بوابة العميل تعمل بالعربية، ويمكنك تجربة العرض التوضيحي خلال دقيقتين دون تثبيت:
https://manosh.fly.dev/demo

سؤال واحد قبل ذلك: هل تدير عملاء الجملة كشركات داخل Shopify؟ التطبيق يقرأهم من هناك.
إن وجدته مفيداً، أُعدّه معك على متجرك في 20 دقيقة. توجد خطة مجانية.

عبدالرحمن، مؤسس Mannon
```

**French first message**

```
Bonjour, j'ai vu que [boutique] demande aux professionnels de [vous écrire pour obtenir
les tarifs / remplir un formulaire].

J'ai créé Mannon, une application Shopify pour cette étape précise : l'acheteur clique
sur « Demander un devis » sur une fiche produit, vous répondez depuis un seul écran, et
le devis accepté devient une commande provisoire Shopify, avec les prix, taxes et
totaux calculés par Shopify.

L'espace acheteur existe en français. Une démo de 2 minutes, sans installation :
https://manosh.fly.dev/demo

Une question avant cela : gérez-vous vos clients professionnels comme des entreprises
dans Shopify ? Mannon les lit à cet endroit. Si cela vous semble utile, je l'installe
avec vous en 20 minutes. Il existe une formule gratuite.

Abdelrahman, fondateur de Mannon
```

**Message to an agency**

```
Hi, I saw [agency] built the B2B store for [client].

I make Mannon, a quoting and reorder app built on Shopify's native B2B: quote requests,
counters, net terms and a passwordless buyer portal, all ending in draft orders.

I'd like one agency partner to tell me where it falls short. If you have a client
asking for quotes, I'll set it up on their store myself, free, and take your feedback.

Demo: https://manosh.fly.dev/demo
```

**Same-day note to a new install** (the founder sends this himself)

```
Hi, I'm Abdelrahman, the founder of Mannon. Thanks for installing.

Two steps get you to a first quote: choose a plan (Free works), then add the Request a
Quote button from Quotes > Requests.

If you'd like, I'll do both with you on a 20-minute call: [booking link]. Or reply here
with any question.
```

---

## 9. Tracking

Keep one sheet with one row per lead. Columns:

`Store | URL | Segment | Language | Shopify confirmed (yes/no) | Uses company accounts
(yes/no/unknown) | Contact route | First message date | Follow-up date | Reply | Status
| Notes`

Status is one of: `New`, `Verified`, `Not Shopify`, `Poor fit`, `Messaged`,
`Followed up`, `Replied`, `Demo viewed`, `Installed`, `Customer`, `Do not contact`.

Five numbers for the Friday review:

| Number | Where it comes from | 30-day target |
|---|---|---|
| Messages sent | The sheet | 200 |
| Replies | The sheet | 20 |
| Installs | Partner Dashboard | 30 |
| Customers (sent a first quote) | The app's analytics | 10 |
| Uninstalls, with the reason | Partner Dashboard, plus a personal note | Under 1 in 3 installs |

For links in posts and messages, add a short tag so the source is visible later, for
example `https://apps.shopify.com/mannon?utm_source=linkedin&utm_campaign=launch`.
Confirm with the founder how listing traffic is reported in the Partner Dashboard
before relying on it.

---

## 10. Open questions for the founder

1. Which Shopify plans include company accounts today? That decides how many stores
   can use Mannon, and whether to qualify on it before or after the demo.
2. Does "customer" mean any plan, or paying only? This plan assumes any plan, with at
   least 3 of the 10 on a paid plan.
3. Monthly budget for App Store ads. This plan assumes about $300.
4. May the first customer be named publicly? Ask them before writing the story.
