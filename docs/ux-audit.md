# UX audit and restructure — embedded admin (November 2026)

Scope: every page of Mannon's embedded Shopify Admin app, checked against Shopify's
current App Home guidance (page patterns, navigation, Built for Shopify UI rules), the
new Polaris (web components) direction, and Shopify-admin patterns on Mobbin. The left
navigation stays as it is; the sections **inside** each item were restructured.

Method: screenshots of all 30 admin pages on the local stack, a line-by-line inventory
of the 40 admin routes, the live shopify.dev docs, and Mobbin references for Shopify's
Orders index, draft-order details, Settings and Home.

---

## 1. Jobs to be done (start here)

Who: the owner or ops/sales lead of a wholesale business on Shopify B2B.

| # | When I… | I want to… | So that… | How often | Where it lives now |
|---|---|---|---|---|---|
| J1 | get a quote request, offer or storefront request | see what's waiting, price it and reply fast | I win the order before the buyer goes elsewhere | Daily | **Home → Needs your attention**, **Quotes** (Quotes · Requests · Offers · Follow-ups) |
| J2 | have buyers who order the same things again | let them reorder and paste POs without me | repeat revenue costs me no time | Daily (buyer side) | Buyer portal; merchant sees it in **Quotes** and **Home → Performance** |
| J3 | sell to companies at negotiated prices | decide who sees which products at which price | each account gets its own deal, nothing leaks | Weekly | **Pricing & catalog** (Price lists · Catalogs · Catalog sharing · Price rules · Order rules) |
| J4 | take on a new wholesale account | approve them, invite their buyers, give terms and a rep | they can order on account | Weekly | **Buyers** (Buyers · Applications · Reps · Credit) |
| J5 | want more B2B demand from my store | put quote/offer buttons and forms on the storefront | visitors become leads | Once, then rarely | **Quote forms**, Requests → Storefront button, Offers → Storefront widget |
| J6 | sell on terms | get invoices paid, deposits taken and tax right | cash comes in on time | Weekly | **Buyers → Credit**, **Settings → Payments / Tax & VAT** |
| J7 | wonder if this is working | see revenue, win rate and what's stuck | I know where to act | Weekly | **Home → Performance**, **Analytics** |
| J8 | set up the app or connect systems | configure once and forget | everything runs without me | Once | **Settings** (General · Notifications · Payments · Tax & VAT · ERP · Accounting · Agency), **Pricing plans** |

Ordering rule used everywhere below: **the job you do most comes first; set-up and
explanations come last, collapsed.**

---

## 2. What we found (before)

Severity: 🔴 blocks a job or breaks a Shopify requirement · 🟠 slows the job down ·
🟡 polish.

### Navigation and flow
- 🔴 **Every "Upgrade" button was a dead end.** About 30 buttons went to Settings, which
  said "Choose Growth below", but the plans had moved to Pricing plans.
- 🔴 **Tabs vanished after upgrading** on 7 pages (Offers, Catalog sharing, Reps, Payments,
  ERP, Accounting, Agency). Once a feature was unlocked, the only way to a sibling tab was the
  left nav.
- 🔴 **Back actions without labels** on 7 subpages, and error pages with no way back
  (BFS 4.1.1: every subpage needs a back button to its parent).
- 🟠 **Pricing & catalog had 7 tabs**, mixing price setup with two negotiation inboxes
  (Offers) and account onboarding (Wholesale).
- 🟠 **Page titles didn't match tab labels** on 10 pages (e.g. tab "Requests", title "Quote
  requests"). App nav guidance: "Match labels to page titles."

### Hierarchy and progressive disclosure
- 🔴 **Settings › General was 14,549 px tall** (≈16 screens):
  - 12 stacked onboarding banners
  - a 19-row plan matrix that duplicated Pricing plans
  - the 5 real settings, in 4th place
  - 34 email templates, all open at once

  It also had 4 Save buttons and no save bar (BFS 4.1.5, 4.3.4).
- 🔴 **Email templates silently lost edits:** the save action stored only 15 of the 34
  templates.
- 🟠 **Set-up came before the work** on Requests, Price rules, Follow-ups, Buyers,
  Applications, Price lists, Catalogs, Order rules, Payments, Tax and Credit. The inbox the
  merchant came for sat at the bottom.
- 🟠 **Home had no entry point to the daily job.** It showed revenue and tiles, but not
  "3 quotes to price".
- 🟡 **Free-floating intro paragraphs** sat outside cards (layout guidance: content lives in
  containers).

### Actions and feedback
- 🔴 **One-click destructive actions** with no confirmation on ~20 controls: decline
  quote/request, delete form/rule/catalog, remove rep/seat/rate, disconnect.
- 🟠 **Quote details put every action in the body**, sometimes 3 primary buttons, with
  add-ons above the line items.
- 🟠 **The Quotes inbox had no views, search or pagination**, so every quote loaded at
  once.
- 🟠 **Raw enums in badges** (`NEW`, `PENDING`), raw JSON and comma lists in forms.
- 🟡 **Hard-coded "$"** prefixes where the currency is known.

### Bugs found during the audit (fixed)
- **Follow-ups:** Scale merchants saw Growth features locked (`isGrowth` ignored Scale).
- **Quote-cap banner:** said "Starter limit / upgrade to Growth", but only Free is capped.
- **ERP:** the Disconnect form was nested inside the Save form.
- **Accounting:** the page ignored the OAuth `?connected` / `?error` results.
- **Order rules:** Priority couldn't be edited; the company scope was mislabelled.
- **Payment plan detail:** loaded any quote's plan without checking the shop.

---

## 3. The new structure (after)

Left nav unchanged: **Home · Quotes · Quote forms · Pricing & catalog · Buyers · Analytics ·
Settings · Pricing plans.** One source of truth for tabs: `app/lib/nav.ts`.

| Nav item | Tabs (in job order) | Inside the page |
|---|---|---|
| **Home** | — | 1 **Needs your attention**: a count per inbox that links to it. 2 **Setup guide**: progress, collapsible, dismissible, first unfinished step open. 3 **Performance**: revenue and 4 metrics, linking to Analytics. 4 Quotes expiring soon. |
| **Quotes** | Quotes · Requests · **Offers** · Follow-ups | **Quotes:** saved views (All, Needs reply, Open, Accepted, Ordered, Expired), search, pagination, all in the URL. **Details:** two columns, actions in the header, Decline behind a confirm. **Requests:** inbox → reply → *Storefront button* (collapsed). **Follow-ups:** due nudges → *policy* (collapsed). |
| **Quote forms** | Quote forms · Languages | **Create form** is the header action and opens a modal. Delete asks first. The builder has a labelled back, a header Save, and *Translations* collapsed. Languages has *Exchange rates* and *Custom translations* collapsed. |
| **Pricing & catalog** | Price lists · Catalogs · Catalog sharing · Price rules · Order rules | Each tab: list → create → *how it works / storefront setup* (collapsed, open on first run). |
| **Buyers** | Buyers · **Applications** · Reps · Credit | Each tab: list or queue first. Credit: aging → invoices → *credit profile* (collapsed). |
| **Analytics** | — | Unchanged order. Title matches the nav. |
| **Settings** | General · **Notifications** · Payments · Tax & VAT · ERP sync · Accounting · Agency | **General**, one section each with a contextual save bar: Quotes and reorders · Buyer sign-in and payment terms · Draft with Claude · Team · Plan summary. **Notifications**: grouped list → one page per email, with a save bar, reset-to-default and a back action. |
| **Pricing plans** | — | Every upgrade button lands here with `?upgrade=<plan>`. A banner explains why, and the needed plan is highlighted. |

### Rules applied on every page
1. **One job first.** Lists, inboxes and queues lead; create forms follow; explanations
   and set-up sit in a `DisclosureCard` (collapsed, open on first run).
2. **Always a way back or across.**
   - Every tabbed page renders its tab bar in every state (locked, empty, unlocked).
   - Every subpage has a labelled back action to its parent.
   - Views, search and pages live in the URL, so the browser back button works.
3. **Header actions.** At most one primary action, and secondary actions only for
   page-wide actions.
4. **Confirm destructive actions** with a modal that names the consequence and uses a
   specific verb (`ConfirmAction`).
5. **Titles match the nav and tab labels.**
6. **Plan gates** look disabled, name the plan, and link to Pricing plans
   (`app/lib/upgrade.ts`).

Shared building blocks: `app/components/DisclosureCard.tsx` and
`app/components/ConfirmAction.tsx`; `StorefrontSetupCard` gains `bare` for use inside a
disclosure. Logic is pure and tested: `app/lib/home.ts`, `app/lib/quote-views.ts`,
`app/lib/notification-templates.ts`.

---

## 4. New Polaris (web components) — plan

Shopify now builds App Home with **Polaris web components** (`s-page`, `s-section`, …) and
App Home patterns. Its migration guide moves one page family at a time, and both systems
can run side by side. This restructure already follows those patterns (homepage, index,
details, settings, setup guide) on the current Polaris React, so the migration is a
component swap, not another redesign.

Suggested order, one session each:
1. Upgrade Polaris React 12 → 13.9.x and React 18 → 19 (needed for controlled
   web-component fields).
2. Settings family (General, Notifications): simple forms that already have a save bar.
3. Home.
4. Quotes family.
5. Pricing & catalog.
6. Buyers.
7. Remaining pages.

## 5. Still open (not in this pass)
- Quote expiry is stored twice: Settings › General and the Follow-up policy. These should
  become one value.
- Form builder and other long forms should get a contextual save bar. Today: Settings ›
  General, each Notifications email and the Offers widget.
- Product, variant and collection fields typed as IDs should use Shopify's resource picker.
- Polaris web-component migration (§4).
