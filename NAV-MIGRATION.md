# Navigation IA merge — 22 pages → 7

Mannon's left-nav went from **22 flat items** to **7 tabbed parents**, matching the
density of competitor quote apps (5–8 nav items). **No feature was removed** — every
old page is still reachable in ≤ 2 clicks (nav parent → tab).

## Approach (why in-page tabs, not nested `<Outlet>` layouts)

Each of the 22 pages owns its own `<Page>`, `primaryAction`, `TitleBar`, loader,
action and `ErrorBoundary`. Folding them under Remix `<Outlet>` layouts would mean
stripping all of that from 15+ files right before App Store resubmission — high churn,
high regression risk. Instead each page renders a shared **`<SectionTabs active="…" />`**
bar inside its own `<Page>` (just under `<TitleBar>`). The page keeps its loader,
action, primaryAction and ErrorBoundary **untouched** — this is a navigation layer, not
a rewrite.

- **Single source of truth:** `app/lib/nav.ts` holds `SECTION_GROUPS` (the tab map) and
  `visibleNavParents()` (the 7 nav links). Both the tab bar (`SectionTabs`) and the
  left-nav (`app/routes/app.tsx`) read from it, so they can never drift.
- **Flag-aware:** a tab shows only when its `MANNON_FF_*` flag is on — the same gate the
  nav uses — so we never link to a route that 404s. A parent shows when ≥1 of its tabs is
  enabled and links to its **first enabled** tab.
- **URL-driven selection:** picking a tab navigates to that page; Polaris sets
  `aria-selected` and handles keyboard. Deep links / bookmarks / back-button work because
  each tab *is* a real URL.

## Before → after

**Before (22):** Quotes · Requests · Quote forms · Price rules · Offers · Follow-ups ·
Analytics · Buyers · Reps · Wholesale · Price lists · Catalogs · Catalog sharing ·
Order rules · Credit · Payments · Tax & VAT · Languages · ERP sync · Accounting · Agency ·
Settings *(+ Home)*

**After (7, + Home):**

| # | Nav parent | Landing URL | Tabs (folded-in pages) |
|---|---|---|---|
| 1 | **Quotes** | `/app/quotes` | Quotes · Requests · Follow-ups |
| 2 | **Quote forms** | `/app/quote-forms` (alias `/app/forms`) | Quote forms · Languages |
| 3 | **Pricing & catalog** | `/app/price-rules` (alias `/app/pricing`) | Price rules · Price lists · Offers · Wholesale · Catalogs · Catalog sharing · Order rules |
| 4 | **Buyers** | `/app/buyers` | Buyers · Reps · Credit |
| 5 | **Analytics** | `/app/analytics` | *(standalone — no tabs)* |
| 6 | **Settings** | `/app/settings` | General · Payments · Tax & VAT · ERP sync · Accounting · Agency |
| 7 | **Pricing plans** | `/app/plans` | *(standalone — 4-plan billing picker)* |

`Home` (`/app`, the ROI dashboard) stays as the App-Bridge-required `rel="home"` row.

## Parent → tab URL map (all 22 old pages)

Old paths are **unchanged** — they are the canonical tab URLs, so nothing 301s and no
bookmark breaks. The only *new* URLs are the two parent aliases and the plans page.

| Old page | Still lives at | Reached via |
|---|---|---|
| Quotes | `/app/quotes` | Quotes ▸ Quotes |
| Requests | `/app/quote-requests` | Quotes ▸ Requests |
| Follow-ups | `/app/followups` | Quotes ▸ Follow-ups |
| Quote forms | `/app/quote-forms` | Quote forms ▸ Quote forms |
| Languages | `/app/i18n` | Quote forms ▸ Languages |
| Price rules | `/app/price-rules` | Pricing & catalog ▸ Price rules |
| Price lists | `/app/price-lists` | Pricing & catalog ▸ Price lists |
| Offers | `/app/offers` | Pricing & catalog ▸ Offers |
| Wholesale | `/app/wholesale` | Pricing & catalog ▸ Wholesale |
| Catalogs | `/app/catalogs` | Pricing & catalog ▸ Catalogs |
| Catalog sharing | `/app/catalog-sharing` | Pricing & catalog ▸ Catalog sharing |
| Order rules | `/app/order-rules` | Pricing & catalog ▸ Order rules |
| Buyers | `/app/buyers` | Buyers ▸ Buyers |
| Reps | `/app/reps` | Buyers ▸ Reps |
| Credit | `/app/credit` | Buyers ▸ Credit |
| Analytics | `/app/analytics` | Analytics |
| Settings | `/app/settings` | Settings ▸ General |
| Payments | `/app/payments` | Settings ▸ Payments |
| Tax & VAT | `/app/tax` | Settings ▸ Tax & VAT |
| ERP sync | `/app/erp` | Settings ▸ ERP sync |
| Accounting | `/app/accounting` | Settings ▸ Accounting |
| Agency | `/app/agency` | Settings ▸ Agency |

**New parent-alias routes** (land on the group's first enabled tab):

| New URL | Redirects to |
|---|---|
| `/app/pricing` | first enabled Pricing & catalog tab (default `/app/price-rules`) |
| `/app/forms` | first enabled Quote forms tab (default `/app/quote-forms`) |
| `/app/plans` | *(real page)* the 4-plan billing picker |

Deep/detail/resource routes (`/app/quotes/:id`, `.pdf`, `.csv`, `/app/analytics/export`,
`accounting-connect/:provider` OAuth callbacks, etc.) are **unchanged** — reached from
within a tab, never the nav, and never redirected.

## Pricing & catalog — the 7-tab layout decision

This is the only group above ~5 tabs. On **Polaris v12**, `Tabs` measures the row and
collapses overflow into a **"More ▾" disclosure** automatically — every tab stays
reachable and keyboard-accessible with correct `aria-selected`, no custom UI (guardrail
#5). At the embedded content width (~1080px) the first ~5 sit inline and the last ~2 fall
under "More":

```
[ Price rules ] [ Price lists ] [ Offers ] [ Wholesale ] [ Catalogs ]   ⋯ More ▾
                                                                          ├ Catalog sharing
                                                                          └ Order rules
```

Kept as native Polaris `Tabs` — no segmented-control fallback needed.

## Billing moved to its own page (bonus fix)

The old in-app plan picker (in Settings) was hardcoded to a **2-plan** ladder (Starter
$29 / Growth $79) that didn't match the App Store listing's **4-plan** ladder. The picker
now lives at **`/app/plans`** and renders the real v3 ladder from `PLAN_PRICING_V3` —
**Free $0 · Starter $9 · Growth $29 · Scale $69** — with the embedded-safe billing return
URL. Settings links to it instead of showing plan cards.

## Tests

`app/lib/nav.test.ts` covers `visibleNavParents` (the 7 parents, first-enabled-tab
targeting, group hiding when all tabs are off, core parents surviving all-flags-off,
standalone Analytics), `firstEnabledTabUrl`, and `SECTION_GROUPS` integrity (21 tab ids,
no dups, every id resolves to its group).
